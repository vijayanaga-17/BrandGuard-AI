import os, re, uuid, json, asyncio
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from pypdf import PdfReader
from io import BytesIO

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip() or "gemini-3.6-flash"
app = FastAPI(title="BrandGuard AI API", version="1.0.0")
origins = [x.strip() for x in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")]
app.add_middleware(CORSMiddleware, allow_origins=origins + ["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# MongoDB persistence when MONGODB_URI is configured; in-memory mode keeps local setup easy.
db = None
try:
    from pymongo import MongoClient
    uri = os.getenv("MONGODB_URI", "").strip()
    if uri:
        client = MongoClient(uri, serverSelectionTimeoutMS=2500)
        client.admin.command("ping")
        db = client[os.getenv("MONGODB_DATABASE", "brandguard")]
except Exception as exc:
    print("MongoDB unavailable; using temporary in-memory storage:", exc)

memory = {"guidelines": [], "reports": []}

def all_docs(collection):
    if db is not None:
        return list(db[collection].find({}, {"_id": 0}).sort("created_at", -1))
    return sorted(memory[collection], key=lambda x: x.get("created_at", ""), reverse=True)

def save_doc(collection, doc):
    if db is not None:
        db[collection].insert_one(doc.copy())
    else:
        memory[collection].append(doc)
    return doc


def update_guideline(guideline_id, changes):
    if db is not None:
        result = db.guidelines.update_one(
            {"id": guideline_id},
            {"$set": changes}
        )
        if result.matched_count == 0:
            return None

        return db.guidelines.find_one(
            {"id": guideline_id},
            {"_id": 0}
        )

    for item in memory["guidelines"]:
        if item["id"] == guideline_id:
            item.update(changes)
            return item

    return None


def delete_guideline(guideline_id):
    if db is not None:
        result = db.guidelines.delete_one({"id": guideline_id})
        return result.deleted_count > 0

    for item in memory["guidelines"]:
        if item["id"] == guideline_id:
            memory["guidelines"].remove(item)
            return True

    return False


def update_report(report_id, changes):
    if db is not None:
        result = db.reports.update_one({"id": report_id}, {"$set": changes})
        return result.matched_count > 0
    for item in memory["reports"]:
        if item["id"] == report_id:
            item.update(changes)
            return True
    return False

class GuidelineIn(BaseModel):
    brand_name: str = Field(min_length=1, max_length=100)
    tone: str = "Clear, helpful and professional"
    approved_facts: list[str] = []
    required_terms: list[str] = []
    prohibited_terms: list[str] = []
    notes: str = ""

class ReviewIn(BaseModel):
    decision: str
    reviewer: str = "Reviewer"
    comment: str = ""

@app.get("/")
def root():
    return {"message": "BrandGuard AI API is running", "docs": "/docs"}

@app.get("/api/health")
def health():
    return {"status": "ok", "database": "mongodb" if db is not None else "demo-memory",
            "ai_mode": "configured" if GEMINI_API_KEY else "disabled",
            "ai_provider": "Gemini" if GEMINI_API_KEY else None,
            "ai_model": GEMINI_MODEL if GEMINI_API_KEY else None}

@app.get("/api/guidelines")
def get_guidelines():
    return all_docs("guidelines")

@app.post("/api/guidelines")
def create_guideline(item: GuidelineIn):
    doc = item.model_dump()
    doc.update({"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat()})
    save_doc("guidelines", doc)
    return doc


@app.put("/api/guidelines/{guideline_id}")
def edit_guideline(guideline_id: str, item: GuidelineIn):
    updated = update_guideline(
        guideline_id,
        item.model_dump()
    )

    if not updated:
        raise HTTPException(404, "Guideline not found.")

    return updated


@app.delete("/api/guidelines/{guideline_id}")
def remove_guideline(guideline_id: str):
    deleted = delete_guideline(guideline_id)

    if not deleted:
        raise HTTPException(404, "Guideline not found.")

    return {"message": "Guideline deleted successfully."}


def analyze_content(content: str, guideline: dict):
    issues = []
    lower = content.lower()
    reported = set()

    def add_issue(issue):
        key = (
            issue["type"].lower(),
            issue["matched_text"].strip().lower()
        )
        if key not in reported:
            reported.add(key)
            issues.append(issue)

    # 1. Check prohibited terminology
    prohibited = guideline.get("prohibited_terms", [])
    prohibited_found = []

    for term in prohibited:
        term = term.strip()
        if term and term.lower() in lower:
            prohibited_found.append(term.lower())

            add_issue({
                "type": "Prohibited terminology",
                "severity": "High",
                "matched_text": term,
                "rule": f"Do not use the term '{term}'.",
                "reason": "This wording is listed in the organisation's prohibited terminology.",
                "suggestion": f"Remove '{term}' or replace it with approved brand wording."
            })

    # 2. Check required terminology
    for term in guideline.get("required_terms", []):
        term = term.strip()

        if term and term.lower() not in lower:
            add_issue({
                "type": "Missing approved terminology",
                "severity": "Medium",
                "matched_text": term,
                "rule": f"Use the approved term '{term}' where relevant.",
                "reason": "The required brand term was not found in the submitted content.",
                "suggestion": f"Consider adding '{term}' if it is relevant to this content."
            })

    # 3. Check potentially unsupported claims
    approved = guideline.get("approved_facts", [])

    
    claim_patterns = [
        r"(?<!\w)100\s*%(?!\w)",
        r"\bguaranteed?\b",
        r"\bnumber\s*1\b",
        r"\bno\.?\s*1\b",
        r"\bbest\b",
        r"\bleading\b",
        r"\bworld'?s\s+first\b",
        r"\bclinically proven\b",
        r"\baward[- ]winning\b",
        r"\bzero risk\b",
        r"\bfastest\b"
    ]


    for sentence in re.split(r"(?<=[.!?])\s+", content):
        for pattern in claim_patterns:
            match = re.search(pattern, sentence, flags=re.I)

            if match:
                phrase = match.group(0)
                phrase_lower = phrase.lower()

                # Do not report the same prohibited phrase twice
                if any(
                    term in phrase_lower or phrase_lower in term
                    for term in prohibited_found
                ):
                    continue

                is_supported = any(
                    sentence.strip().lower() in fact.lower()
                    or phrase_lower in fact.lower()
                    for fact in approved
                )

                if not is_supported:
                    add_issue({
                        "type": "Potentially unsupported claim",
                        "severity": "High",
                        "matched_text": phrase,
                        "rule": "Claims must be supported by an approved brand fact.",
                        "reason": "This promotional or absolute claim could not be matched to the supplied approved facts. This is a flag for human verification, not a factual verdict.",
                        "suggestion": "Remove the absolute claim or replace it with a precise statement supported by an approved fact."
                    })

    # 4. Check tone consistency
    if guideline.get("tone"):
        informal = ["hey guys", "gonna", "wanna", "!!!", "lol"]

        for phrase in informal:
            if phrase in lower:
                add_issue({
                    "type": "Tone consistency",
                    "severity": "Low",
                    "matched_text": phrase,
                    "rule": f"Target tone: {guideline['tone']}.",
                    "reason": "This phrase may not match the organisation's stated tone.",
                    "suggestion": "Rewrite this phrase in a clear, professional style."
                })

    # 5. Show a message if no issues are found
    if not issues:
        issues.append({
            "type": "No rule-based issues found",
            "severity": "Info",
            "matched_text": "",
            "rule": "Content was checked against the saved guideline.",
            "reason": "The basic terminology and claim checks did not detect a configured violation. This does not guarantee that the content is fully compliant.",
            "suggestion": "Review the content and approve it only after human verification."
        })

    return issues


async def analyze_with_gemini(content: str, guideline: dict):
    """Return AI findings and a status string. Never make AI the final approver."""
    if not GEMINI_API_KEY:
        return [], "disabled", None

    try:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)
        prompt = f"""You are a brand-compliance reviewer. Analyze the submitted content against the brand guidelines.
Return ONLY valid JSON in this shape: {{"issues": [{{"type": "...", "severity": "High|Medium|Low", "matched_text": "exact quote or short phrase", "rule": "guideline being checked", "reason": "brief explanation", "suggestion": "specific safer rewrite"}}]}}.
Return an empty issues array if there are no findings. Do not invent facts. Flag claims not supported by the approved facts, contradictions, misleading/absolute claims, tone mismatches, and context-sensitive guideline violations. Avoid duplicating obvious exact prohibited-term or missing-required-term checks unless there is additional context. Findings are suggestions for human review, not decisions.

BRAND GUIDELINES:
Brand: {guideline.get('brand_name', '')}
Tone: {guideline.get('tone', '')}
Approved facts: {json.dumps(guideline.get('approved_facts', []), ensure_ascii=False)}
Required terms: {json.dumps(guideline.get('required_terms', []), ensure_ascii=False)}
Prohibited terms: {json.dumps(guideline.get('prohibited_terms', []), ensure_ascii=False)}
Additional notes: {guideline.get('notes', '')}

SUBMITTED CONTENT:
{content}
"""
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=GEMINI_MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json", "temperature": 0.2},
        )
        raw = (response.text or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.I).strip()
        parsed = json.loads(raw)
        findings = parsed.get("issues", []) if isinstance(parsed, dict) else parsed
        if not isinstance(findings, list):
            raise ValueError("Gemini response did not contain an issues list")

        cleaned = []
        for finding in findings:
            if not isinstance(finding, dict):
                continue
            cleaned.append({
                "type": "AI analysis: " + str(finding.get("type", "Brand compliance"))[:120],
                "severity": str(finding.get("severity", "Medium")) if finding.get("severity") in ["High", "Medium", "Low", "Info"] else "Medium",
                "matched_text": str(finding.get("matched_text", ""))[:500],
                "rule": str(finding.get("rule", "Check against brand guidelines"))[:500],
                "reason": str(finding.get("reason", "AI identified a potential issue."))[:1000],
                "suggestion": str(finding.get("suggestion", "Review and revise if necessary."))[:1000],
            })
        return cleaned, "used", None
    except Exception as exc:
        print("GEMINI ERROR:", repr(exc))
        # Keep the local rule-based analysis available if Gemini fails.
        return [], "failed_fallback", f"Gemini analysis failed: {type(exc).__name__}. Rule-based results are shown."


@app.post("/api/analyze")
async def analyze(text: Optional[str] = Form(None), guideline_id: Optional[str] = Form(None),
                file: Optional[UploadFile] = File(None)):
    content = (text or "").strip()
    filename = None
    if isinstance(file, str) and not file.strip():
        file = None  # Swagger may send an empty string for an optional upload
    if file:
        filename = file.filename
        raw = await file.read()
        if file.filename.lower().endswith(".pdf"):
            try:
                reader = PdfReader(BytesIO(raw))
                content = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
            except Exception as exc:
                raise HTTPException(400, f"Could not read this PDF: {exc}")
        else:
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError:
                raise HTTPException(400, "Please upload a text file or a text-based PDF.")
    if not content:
        raise HTTPException(400, "Enter content or upload a text-based PDF.")
    guidelines = all_docs("guidelines")
    guideline = next((g for g in guidelines if g["id"] == guideline_id), None) if guideline_id else (guidelines[0] if guidelines else None)
    if not guideline:
        raise HTTPException(400, "Add a brand guideline before checking content.")
    rule_issues = analyze_content(content, guideline)
    ai_issues, ai_status, ai_error = await analyze_with_gemini(content, guideline)
    if ai_issues:
    # Remove the informational placeholder when AI finds issues.
        rule_issues = [
            i for i in rule_issues
            if i.get("type") != "No rule-based issues found"
        ]

    filtered_ai = []

    for ai in ai_issues:
        ai_text = str(ai.get("matched_text", "")).lower().strip()
        ai_type = str(ai.get("type", "")).lower()

        duplicate = False

        for rule in rule_issues:
            rule_text = str(rule.get("matched_text", "")).lower().strip()
            rule_type = str(rule.get("type", "")).lower()

            # Exact or overlapping matched text
            if ai_text and rule_text and (
                ai_text == rule_text
                or ai_text in rule_text
                or rule_text in ai_text
            ):
                duplicate = True
                break

            # Same issue category already found by rule-based checker
            if "prohibit" in ai_type and "prohibit" in rule_type:
                duplicate = True
                break

            if (
                ("missing" in ai_type or "required term" in ai_type)
                and ("missing" in rule_type or "terminology" in rule_type)
            ):
                duplicate = True
                break

        if not duplicate:
            filtered_ai.append(ai)

    ai_issues = filtered_ai

    issues = rule_issues + ai_issues
    report = {
        "id": str(uuid.uuid4()), "content": content, "filename": filename,
        "guideline_id": guideline["id"], "brand_name": guideline["brand_name"],
        "issues": issues, "status": "Pending human review",
        "ai_analysis_status": ai_status, "ai_model": GEMINI_MODEL if ai_status == "used" else None,
        "ai_error": ai_error,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "review": None
    }
    save_doc("reports", report)
    return report

@app.get("/api/reports")
def get_reports():
    return all_docs("reports")

@app.post("/api/reports/{report_id}/review")
def review_report(report_id: str, item: ReviewIn):
    if item.decision not in ["Approved", "Rejected", "Changes requested"]:
        raise HTTPException(400, "Decision must be Approved, Rejected, or Changes requested.")
    changes = {"status": item.decision, "review": {
        "decision": item.decision, "reviewer": item.reviewer,
        "comment": item.comment, "reviewed_at": datetime.now(timezone.utc).isoformat()
    }}
    if not update_report(report_id, changes):
        raise HTTPException(404, "Report not found.")
    return {"id": report_id, **changes}
