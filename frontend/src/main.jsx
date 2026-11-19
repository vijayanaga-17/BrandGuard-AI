
import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  ShieldCheck, Upload, BookOpen, ScanSearch, ClipboardList,
  CheckCircle2, AlertTriangle, Plus, FileText, RefreshCw,
  XCircle, Clock3, Pencil, Trash2, X
} from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function request(path, options={}) {
  const res = await fetch(`${API}${path}`, options);
  const data = await res.json().catch(()=>({detail:'Unexpected server response'}));
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function App(){
  const [tab,setTab]=useState('check');
  const [guidelines,setGuidelines]=useState([]);
  const [reports,setReports]=useState([]);
  const [selected,setSelected]=useState('');
  const [text,setText]=useState('');
  const [file,setFile]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [latest,setLatest]=useState(null);
  const [health,setHealth]=useState(null);
  const [editingId,setEditingId]=useState(null);

  const emptyForm={
    brand_name:'',
    tone:'Clear, helpful and professional',
    approved_facts:'',
    required_terms:'',
    prohibited_terms:'',
    notes:''
  };

  const [form,setForm]=useState(emptyForm);
  const [reviewer,setReviewer]=useState('Brand Reviewer');
  const [comment,setComment]=useState('');

  async function refresh(){
    try{
      const [g,r,h]=await Promise.all([
        request('/api/guidelines'),
        request('/api/reports'),
        request('/api/health')
      ]);
      setGuidelines(g);
      setReports(r);
      setHealth(h);

      if(g.length && !g.some(x=>x.id===selected)){
        setSelected(g[0].id);
      }
      if(!g.length) setSelected('');
    }catch(e){
      setError(e.message);
    }
  }

  useEffect(()=>{
    refresh();
  },[]);

  function makePayload(){
    return {
      brand_name:form.brand_name,
      tone:form.tone,
      notes:form.notes,
      approved_facts:form.approved_facts.split('\n').map(x=>x.trim()).filter(Boolean),
      required_terms:form.required_terms.split(',').map(x=>x.trim()).filter(Boolean),
      prohibited_terms:form.prohibited_terms.split(',').map(x=>x.trim()).filter(Boolean)
    };
  }

  async function saveGuideline(e){
    e.preventDefault();
    setError('');

    try{
      const payload=makePayload();

      if(editingId){
        const updated=await request(`/api/guidelines/${editingId}`,{
          method:'PUT',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });

        setSelected(updated.id);
      }else{
        const created=await request('/api/guidelines',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });

        setSelected(created.id);
      }

      setForm(emptyForm);
      setEditingId(null);
      await refresh();

    }catch(e){
      setError(e.message);
    }
  }

  function startEdit(g){
    setEditingId(g.id);
    setForm({
      brand_name:g.brand_name || '',
      tone:g.tone || '',
      approved_facts:(g.approved_facts || []).join('\n'),
      required_terms:(g.required_terms || []).join(', '),
      prohibited_terms:(g.prohibited_terms || []).join(', '),
      notes:g.notes || ''
    });
    setTab('guidelines');
    setError('');
  }

  function cancelEdit(){
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  }

  async function deleteGuideline(g){
    const confirmed=window.confirm(
      `Are you sure you want to delete the guideline "${g.brand_name}"?`
    );

    if(!confirmed) return;

    setError('');

    try{
      await request(`/api/guidelines/${g.id}`,{method:'DELETE'});

      if(editingId===g.id){
        cancelEdit();
      }

      await refresh();

    }catch(e){
      setError(e.message);
    }
  }

  async function analyze(e){
    e.preventDefault();
    setError('');
    setLatest(null);
    setLoading(true);

    try{
      const data=new FormData();
      data.append('guideline_id',selected);

      if(text.trim()) data.append('text',text);
      if(file) data.append('file',file);

      const report=await request('/api/analyze',{
        method:'POST',
        body:data
      });

      setLatest(report);
      setText('');
      setFile(null);
      await refresh();

    }catch(e){
      setError(e.message);
    }finally{
      setLoading(false);
    }
  }

  async function decide(decision){
    if(!latest) return;

    try{
      await request(`/api/reports/${latest.id}/review`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({decision,reviewer,comment})
      });

      const updated={
        ...latest,
        status:decision,
        review:{decision,reviewer,comment}
      };

      setLatest(updated);
      setComment('');
      await refresh();

    }catch(e){
      setError(e.message);
    }
  }

  const issueCount=latest?.issues?.filter(
    x=>x.severity!=='Info'
  ).length || 0;

  return <div className="app">

    <header className="topbar">
      <div className="brand">
        <div className="logo"><ShieldCheck/></div>
        <div>
          <b>BrandGuard <span>AI</span></b>
          <small>Brand governance workspace</small>
        </div>
      </div>

      <div className="topright">
        <span className={`dot ${health?.status==='ok'?'':'off'}`}></span>
        {health?.database==='mongodb'?'MongoDB connected':'Demo storage'}
        <button className="iconbtn" onClick={refresh} title="Refresh">
          <RefreshCw size={16}/>
        </button>
      </div>
    </header>

    <main>
      <section className="hero">
        <div>
          <div className="eyebrow">CONTENT COMPLIANCE WORKSPACE</div>
          <h1>Protect your brand <em>before</em> you publish.</h1>
          <p>Check content against your organisation's approved facts, terminology and tone. Review every finding before making the final decision.</p>
        </div>
        <div className="heroMark">
          <ShieldCheck size={76}/>
          <span>Human-led<br/>approval</span>
        </div>
      </section>

      <section className="stats">
        <div className="stat">
          <BookOpen/>
          <div><strong>{guidelines.length}</strong><small>Brand guidelines</small></div>
        </div>
        <div className="stat">
          <ClipboardList/>
          <div><strong>{reports.length}</strong><small>Content checks</small></div>
        </div>
        <div className="stat">
          <Clock3/>
          <div>
            <strong>{reports.filter(r=>r.status==='Pending human review').length}</strong>
            <small>Awaiting review</small>
          </div>
        </div>
      </section>

      <nav className="tabs">
        <button className={tab==='check'?'active':''} onClick={()=>setTab('check')}>
          <ScanSearch size={17}/> Check content
        </button>
        <button className={tab==='guidelines'?'active':''} onClick={()=>setTab('guidelines')}>
          <BookOpen size={17}/> Brand guidelines
        </button>
        <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>
          <ClipboardList size={17}/> Review history
        </button>
      </nav>

      {error && <div className="error">
        <AlertTriangle size={17}/>{error}
        <button onClick={()=>setError('')}><XCircle size={16}/></button>
      </div>}

      {tab==='guidelines' && <section className="panel">

        <div className="panelhead">
          <div>
            <div className="eyebrow">BRAND KNOWLEDGE</div>
            <h2>Guideline library</h2>
            <p>Define the rules BrandGuard should use during checks.</p>
          </div>
        </div>

        <form className="guidelineForm" onSubmit={saveGuideline}>

          <label>Organisation / brand name
            <input required value={form.brand_name}
              onChange={e=>setForm({...form,brand_name:e.target.value})}
              placeholder="e.g. Acme Technologies"/>
          </label>

          <label>Brand tone
            <input value={form.tone}
              onChange={e=>setForm({...form,tone:e.target.value})}
              placeholder="e.g. Friendly, clear and professional"/>
          </label>

          <label className="full">Approved facts
            <small>One verified fact per line. Only enter facts approved by your organisation.</small>
            <textarea rows="4" value={form.approved_facts}
              onChange={e=>setForm({...form,approved_facts:e.target.value})}
              placeholder="Founded in 2015&#10;Headquarters are in Hyderabad"/>
          </label>

          <label>Required terminology
            <small>Separate terms with commas.</small>
            <textarea rows="3" value={form.required_terms}
              onChange={e=>setForm({...form,required_terms:e.target.value})}
              placeholder="BrandGuard, customer"/>
          </label>

          <label>Prohibited terminology
            <small>Separate terms with commas.</small>
            <textarea rows="3" value={form.prohibited_terms}
              onChange={e=>setForm({...form,prohibited_terms:e.target.value})}
              placeholder="cheap, guaranteed results"/>
          </label>

          <label className="full">Additional brand notes
            <textarea rows="2" value={form.notes}
              onChange={e=>setForm({...form,notes:e.target.value})}
              placeholder="Any additional rules for writers and reviewers"/>
          </label>

          <div className="formActions">
            <button className="primary" type="submit">
              {editingId?<><CheckCircle2 size={17}/> Update guideline</>:<><Plus size={17}/> Save brand guidelines</>}
            </button>

            {editingId && <button className="secondary" type="button" onClick={cancelEdit}>
              <X size={17}/> Cancel editing
            </button>}
          </div>
        </form>

        <div className="saved">
          <h3>Saved guidelines</h3>

          {guidelines.length===0?
            <p className="muted">No guidelines added yet.</p>:
            guidelines.map(g=><div className="saveditem" key={g.id}>
              <div className="savedinfo">
                <b>{g.brand_name}</b>
                <small>{g.tone} · {(g.approved_facts || []).length} approved facts</small>
              </div>

              <span className="pill">Active</span>

              <div className="guidelineActions">
                <button className="editbtn" onClick={()=>startEdit(g)} title="Edit guideline">
                  <Pencil size={16}/> Edit
                </button>

                <button className="deletebtn" onClick={()=>deleteGuideline(g)} title="Delete guideline">
                  <Trash2 size={16}/> Delete
                </button>
              </div>
            </div>)
          }
        </div>
      </section>}

      {tab==='check' && <section className="workspace">

        <div className="panel">
          <div className="panelhead">
            <div>
              <div className="eyebrow">STEP 01 · SUBMIT</div>
              <h2>Check your content</h2>
              <p>Choose a brand guideline, then paste content or upload a text-based PDF.</p>
            </div>
          </div>

          {guidelines.length===0?
            <div className="empty">
              <BookOpen size={34}/>
              <b>Set up your brand guidelines first</b>
              <p>Add approved facts and terminology so the checker knows what to verify.</p>
              <button className="primary" onClick={()=>setTab('guidelines')}>Add guidelines</button>
            </div>:
            <form onSubmit={analyze}>
              <label>Brand guideline
                <select value={selected} onChange={e=>setSelected(e.target.value)}>
                  {guidelines.map(g=><option key={g.id} value={g.id}>{g.brand_name}</option>)}
                </select>
              </label>

              <label>Paste content
                <textarea rows="9" value={text}
                  onChange={e=>setText(e.target.value)}
                  placeholder="Paste a social media post, advertisement, email or other draft content here..."/>
              </label>

              <div className="or">OR UPLOAD A FILE</div>

              <label className="upload">
                <Upload size={22}/>
                <b>{file?file.name:'Choose a PDF or TXT file'}</b>
                <small>Text-based PDF and UTF-8 text files supported</small>
                <input type="file" accept=".pdf,.txt,text/plain,application/pdf"
                  onChange={e=>setFile(e.target.files[0]||null)}/>
              </label>

              <button className="primary wide" disabled={loading || (!text.trim()&&!file)}>
                {loading?'Checking content...':<><ScanSearch size={18}/> Analyse against brand rules</>}
              </button>
            </form>
          }
        </div>

        <div className="panel results">
          <div className="panelhead">
            <div>
              <div className="eyebrow">STEP 02 · REVIEW FINDINGS</div>
              <h2>Analysis report</h2>
              <p>Every issue includes the rule and a suggested correction.</p>
            </div>
          </div>

          {!latest?
            <div className="empty">
              <ClipboardList size={38}/>
              <b>Your report will appear here</b>
              <p>Submit content to see brand compliance findings.</p>
            </div>:
            <>
              <div className="reporttop">
                <div>
                  <span className="eyebrow">CHECK COMPLETE</span>
                  <h3>{latest.brand_name}</h3>
                  <small>{latest.filename||'Pasted content'} · {new Date(latest.created_at).toLocaleString()}</small>
                </div>
                <div className="score">
                  <strong>{issueCount}</strong>
                  <small>Potential issues</small>
                </div>
              </div>

              {latest.issues.map((issue,i)=><article className="issue" key={i}>
                <div className="issuetop">
                  <b>{issue.type}</b>
                  <span className={`severity ${issue.severity.toLowerCase()}`}>{issue.severity}</span>
                </div>
                {issue.matched_text&&<div className="matched">“{issue.matched_text}”</div>}
                <p>{issue.reason}</p>
                <div className="rule"><b>Rule:</b> {issue.rule}</div>
                <div className="suggestion"><b>Suggested correction:</b> {issue.suggestion}</div>
              </article>)}

              <div className="approval">
                <h3><CheckCircle2 size={19}/> Human review decision</h3>
                <p>Automated findings are guidance only. A human reviewer makes the final approval decision.</p>

                <label>Reviewer name
                  <input value={reviewer} onChange={e=>setReviewer(e.target.value)}/>
                </label>

                <label>Review comment
                  <textarea rows="2" value={comment}
                    onChange={e=>setComment(e.target.value)}
                    placeholder="Add a review note (optional)"/>
                </label>

                <div className="actions">
                  <button className="approve" onClick={()=>decide('Approved')}>Approve</button>
                  <button className="changes" onClick={()=>decide('Changes requested')}>Request changes</button>
                  <button className="reject" onClick={()=>decide('Rejected')}>Reject</button>
                </div>

                <div className="statusline">Current status: <b>{latest.status}</b></div>
              </div>
            </>
          }
        </div>
      </section>}

      {tab==='history' && <section className="panel">
        <div className="panelhead">
          <div>
            <div className="eyebrow">AUDIT TRAIL</div>
            <h2>Review history</h2>
            <p>Previously checked content and human decisions.</p>
          </div>
        </div>

        {reports.length===0?
          <div className="empty">
            <ClipboardList size={36}/>
            <b>No checks yet</b>
            <p>Reports will be listed here after the first content check.</p>
          </div>:
          <div className="history">
            {reports.map(r=><div className="historyrow" key={r.id}>
              <div className="fileicon"><FileText/></div>
              <div className="historymain">
                <b>{r.filename||'Pasted content'}</b>
                <small>{r.brand_name} · {new Date(r.created_at).toLocaleString()}</small>
              </div>
              <span className={`status ${r.status==='Approved'?'good':r.status==='Rejected'?'bad':'pending'}`}>{r.status}</span>
              <button className="textbtn" onClick={()=>{setLatest(r);setTab('check')}}>Open report</button>
            </div>)}
          </div>
        }
      </section>}

      <footer>
        <ShieldCheck size={16}/> BrandGuard AI
        <span>·</span> AI-assisted checking, human-controlled publishing
      </footer>
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
