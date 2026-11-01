import {groupJobs} from './job-groups.js';
import {taskDuration,formatDuration,totalDuration} from './duration.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const media=f=>'/media/'+f.split('/').map(encodeURIComponent).join('/');
const motionNames={push:'B5 · 慢慢放大',still:'固定画面'};
const kindNames={draft:'起草文案',storyboard:'生成分镜',images:'生成画面',speech:'生成配音',render:'合成视频',workflow:'完整制作',delivery:'首图与发布内容'};
const jobNames={queued:'排队中',running:'制作中',cancelling:'正在停止',done:'已完成',failed:'待恢复',waiting:'等待恢复',cancelled:'已取消',interrupted:'已中断'};
let state,health,p,screen='editor',tab='simple',selected=0,version=null,dirty=false,saving=false,saveTimer,sample=new Audio(),playing=null,toastTimer,uploadScene;
const batchSelection=new Set();let batchSubmitting=false,deleteTargetId=null,deleting=false;
const batchEligible=x=>!!x.script.trim()&&!state.jobs.some(j=>j.projectId===x.id&&['queued','running','cancelling','waiting'].includes(j.state));
const busy=()=>state?.jobs.find(j=>j.projectId===p?.id&&['queued','running','cancelling','waiting'].includes(j.state));
const disable=()=>busy()?'disabled':'';
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{'Content-Type':'application/json','X-Workbench-Token':state?.token||'',...options.headers},body:options.body?JSON.stringify(options.body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'操作未完成');return d;}
function clearProject(){clearTimeout(saveTimer);sample.pause();p=null;dirty=false;version=null;selected=0;localStorage.removeItem('story-project');}
function setProject(next){p=structuredClone(next);selected=Math.min(selected,Math.max(0,p.scenes.length-1));localStorage.setItem('story-project',p.id);version=null;dirty=false;}
function changed(){dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(e=>toast(e.message)),700);updateSaveLabel();}
function updateSaveLabel(){const e=$('#save-state');if(e)e.textContent=saving?'正在保存…':dirty?'有修改，等待保存':'已保存到本机';}
async function save(){
  clearTimeout(saveTimer);
  if(saving){await new Promise(r=>setTimeout(r,80));return save();}
  if(!dirty||!p)return;
  const currentId=p.id,serialized=JSON.stringify(p);saving=true;updateSaveLabel();
  try{const result=await api(`/api/projects/${p.id}`,{method:'PUT',body:JSON.parse(serialized)});if(p?.id===currentId){p.revision=result.revision;p.updated=result.updated;p.renderCurrent=result.renderCurrent;p.speechCurrent=result.speechCurrent;if(JSON.stringify({...p,revision:JSON.parse(serialized).revision,updated:JSON.parse(serialized).updated,renderCurrent:JSON.parse(serialized).renderCurrent,speechCurrent:JSON.parse(serialized).speechCurrent})===serialized)dirty=false;else{
      // Changes made while the request was in flight are saved against the new revision.
      const before=JSON.parse(serialized);dirty=['title','script','voice','speed','style','subtitle','transition','opening','sfx','scenes'].some(k=>JSON.stringify(p[k])!==JSON.stringify(before[k]));
    }}const i=state.projects.findIndex(x=>x.id===result.id);if(i>=0)state.projects[i]=result;
  }finally{saving=false;updateSaveLabel();}
  if(dirty)return save();
}
function steps(){return `<div class="steps">${[['simple','提交与验收'],['script','文案'],['voices','声音'],['scenes','分镜制作'],['preview','成片预览']].map(([key,name],i)=>`<button data-action="tab" data-tab="${key}" class="${tab===key?'active':''}">${name}</button>`).join('')}</div>`;}
function branchStatus(j){
 return j.branches?`<div class="production-stages">${Object.entries(j.branches).map(([key,b])=>`<span>${key==='images'?'画面':'配音字幕'} · ${b.state==='done'?'已完成':b.state==='failed'?'待恢复':esc(b.message)}${key==='images'&&b.state==='running'?` · 正在生成 ${b.active||0}/2 张`:''}</span>`).join('')}</div>`:'';
}
function productionStatus(){
 const job=busy(),last=state.jobs.filter(j=>j.projectId===p.id).at(-1);
 const total=p.scenes.length,ready=p.scenes.filter(s=>s.image).length;
 const aligned=total>0&&p.scenes.map(s=>s.text).join('').replace(/\s/g,'')===p.script.replace(/\s/g,'');
 const parts=[aligned?1:0,total?ready/total:0,p.speechCurrent?1:0,p.renderCurrent?1:0,p.renderCurrent&&p.renders.at(-1)?.delivery?.key===p.renders.at(-1)?.key?1:0];
 const completed=parts.filter(v=>v===1).length;
 const percent=Math.floor(parts.reduce((a,b)=>a+b,0)*20);
 const failed=!job&&last&&['failed','interrupted','cancelled'].includes(last.state);
 const current=job?`${jobNames[job.state]} · ${job.message}`:parts[4]?'制作完成':failed?`上次任务${jobNames[last.state]}：${last.message}`:!total?'等待拆分镜':ready<total?'等待生成分镜图片':!p.speechCurrent?'等待生成配音':p.renderCurrent?'等待制作首图和发布内容':'等待合成视频';
 if(!total&&!job&&!failed)return '';
 return `<section class="production-status compact-status" aria-label="制作进度"><div class="row between wrap"><strong>${esc(current)}</strong><span class="muted">${percent}%</span></div><div class="progress" role="progressbar" aria-label="整体制作流程" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div><div class="compact-stages">${['分镜','画面','配音','成片','发布素材'].map((name,i)=>`<span class="${parts[i]===1?'complete':''}">${parts[i]===1?'✓ ':''}${name}${i===1&&total?` ${ready}/${total}`:''}</span>`).join('')}</div>${job?branchStatus(job):!parts[4]?`<button class="primary small" data-action="task" data-kind="workflow" ${!p.script.trim()?'disabled':''}>继续制作 →</button>`:''}</section>`;
}
function quotaWindow(w){
 const mins=w.windowDurationMins;
 return `${w.bucketName==='codex'?'订阅':w.bucketName} · ${mins===10080?'周额度':mins===300?'5 小时额度':mins>=1440?(mins/1440)+' 天额度':mins>=60?(mins/60)+' 小时额度':mins+' 分钟额度'}`;
}
function quotaResult(record){
 if(!record)return '尚无额度记录';
 if(record.status==='recording')return '正在记录制作前后额度';
 if(record.status==='interrupted')return '任务中断，缺少结束快照';
 if(record.status==='account_changed')return '账户无法核对或已切换，无法比较';
 if(record.status==='unavailable')return '额度读取不完整，无法比较';
 const rows=(record.windows||[]).map(w=>`${esc(quotaWindow(w))}：${w.reason?esc(w.reason):`${w.beforeUsedPercent}% → ${w.afterUsedPercent}%（${w.deltaPoints===0?'未观察到变化':`增加 ${w.deltaPoints} 个百分点`}）`}`);
 return rows.join('<br>')+(record.status==='overlap'?'<br><strong>与其他制作任务重叠，不能单独归因，也不能相加。</strong>':'');
}
function quotaSummary(project){
 const s=project.subscriptionSummary;
 if(!s?.included)return s?.excluded?'暂无可单独累计的记录':'尚无额度记录';
 return s.windows.map(w=>`${esc(quotaWindow(w))}累计观测变化 ${w.deltaPoints} 个百分点（${w.tasks} 次任务）`).join('<br>')+(s.excluded?`<br>另有 ${s.excluded} 次记录不计入累计（重叠、读取不完整或中断）`:'');
}
function timeRecords(){return p.taskRecords||state.jobs.filter(j=>j.projectId===p.id).map(j=>({...j,jobId:j.id}));}
function recordTime(r){return r.state==='queued'?'排队中，尚未开始':!r.started?'未开始制作':r.state==='interrupted'?'已中断，用时未知':`${['running','cancelling'].includes(r.state)?'已用时':'用时'} ${formatDuration(taskDuration(r))}`;}
function subscriptionPanel(){
 const records=timeRecords();if(!records.length)return '';
 return `<details class="panel quota-panel record-panel"><summary>制作记录 <span class="muted">${records.length} 次 · 累计 <span id="total-duration">${formatDuration(totalDuration(records))}</span></span></summary><div class="record-content">${records.slice().reverse().map(r=>`<article class="quota-record"><strong>${esc(kindNames[r.kind]||r.kind)} · ${esc(jobNames[r.state]||r.state)}</strong><p data-job-duration="${esc(r.jobId)}">${recordTime(r)}</p><small class="muted">${esc(r.started?new Date(r.started).toLocaleString('zh-CN'):'尚未开始')}</small></article>`).join('')}</div></details>`;
}

function updateDurationDisplays(){
 if(!p||!$('#total-duration'))return;
 const records=timeRecords();$('#total-duration').textContent=formatDuration(totalDuration(records));
 document.querySelectorAll('[data-job-duration]').forEach(el=>{const r=records.find(r=>r.jobId===el.dataset.jobDuration);if(r)el.textContent=recordTime(r);});
}
function subscriptionCurrent(){
 const snapshot=health?.subscription;
 if(!snapshot?.ok)return esc(snapshot?.error||'尚未读取');
 return snapshot.windows.map(w=>`${esc(quotaWindow(w))}：剩余 ${Math.max(0,100-w.usedPercent)}%`).join('<br>')+`<br><small>读取于 ${esc(new Date(snapshot.capturedAt).toLocaleString('zh-CN'))}</small>`;
}
function render(){
  const usageExpanded=document.querySelector('.quota-panel')?.open;
  const expandedHistory=new Set([...document.querySelectorAll('.job-history[open]')].map(el=>el.dataset.projectHistory));
  const oldVideo=$('#film');const playback=oldVideo?{time:oldVideo.currentTime,paused:oldVideo.paused,src:oldVideo.getAttribute('src')}:null;
  const j=busy();
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><span class="logo">▧</span><div>视频故事工坊<small>STORY STUDIO</small></div></div><nav class="nav">${[['editor','▦','制作工作台'],['projects','▤','我的作品'],['jobs','◷','制作任务'],['settings','⚙','设置']].map(([key,icon,title])=>`<button data-action="screen" data-screen="${key}" class="${screen===key?'active':''}"><span class="nav-icon">${icon}</span>${title}</button>`).join('')}</nav><div class="side-projects"><div class="side-label">最近作品</div>${state.projects.slice().reverse().slice(0,8).map(x=>`<button data-action="open" data-id="${x.id}" class="project-link ${p?.id===x.id?'active':''}"><span class="project-dot"></span><span class="ellipsis">${esc(x.title)}</span></button>`).join('')}<button class="quiet small" data-action="new">＋ 新建作品</button></div><div class="sidebar-bottom"><span class="status-dot"></span>本地工作空间<br>素材与成片保存在本机</div></aside><main class="main"><header class="topbar"><div class="title-block"><div class="project-title ellipsis">${esc(p?.title||'我的视频故事')}</div><div class="save-state" id="save-state">${dirty?'有修改，等待保存':'已保存到本机'}</div></div><div class="top-actions"><span class="status-pill ${health?.login?'':'pending'}">${health?.login?'GPT 已登录':health?'GPT 未登录':'正在检查连接'}</span>${p&&screen==='editor'?`<button class="quiet small danger delete-current" data-action="delete-project" data-id="${p.id}" ${j?'disabled':''}>删除作品</button>`:''}${p&&screen==='editor'?`<button class="quiet small" data-action="save">保存</button>`:''}${p&&tab!=='simple'&&screen==='editor'?`<button class="primary" data-action="task" data-kind="workflow" ${!p.script.trim()||j?'disabled':''}>开始制作</button>`:''}</div></header>${j?`<div class="jobbar"><span>${esc(kindNames[j.kind])} · ${esc(j.message)} <strong>${j.progress}%</strong></span><button class="small" data-action="cancel" data-id="${j.id}" ${j.state==='cancelling'?'disabled':''}>停止任务</button></div>`:''}<div class="content">${screen==='projects'?projectsView():screen==='jobs'?jobsView():screen==='settings'?settingsView():p?productionStatus()+subscriptionPanel()+(tab==='simple'?'':steps())+editorView():'<div class="empty"><h2>做出你的第一个视频故事</h2><p>从一个主题，或一段已经写好的文案开始。</p><br><button class="primary" data-action="new">新建作品</button></div>'}</div></main></div>`;
  if(usageExpanded&&document.querySelector('.quota-panel'))document.querySelector('.quota-panel').open=true;
  document.querySelectorAll('.job-history').forEach(el=>{el.open=expandedHistory.has(el.dataset.projectHistory);});
  if(playback&&$('#film')?.getAttribute('src')===playback.src){const v=$('#film');v.addEventListener('loadedmetadata',()=>{v.currentTime=playback.time;if(!playback.paused)v.play().catch(()=>{});},{once:true});}
}
function editorView(){if(tab==='simple')return simpleView();if(tab==='voices')return voicesView();if(tab==='scenes')return scenesView();if(tab==='preview')return previewView();return scriptView();}
function heading(title,sub,extra=''){return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${extra}</div>`;}
function simpleView(){
 const r=p.renders.at(-1),d=p.renderCurrent&&r?.delivery?.key===r.key?r.delivery:null;
 if(d)return heading('制作完成，等你验收','视频、3:4 首图和小红书内容已准备好。')+`<div class="delivery-grid"><section><video id="film" class="delivery-video" controls src="${media(r.video)}"></video><div class="row wrap" style="margin-top:14px"><a class="download" href="/api/projects/${p.id}/export?file=video" download>下载视频</a><button data-action="tab" data-tab="script">修改文案 / 高级编辑</button></div></section><section><img class="delivery-cover" src="${media(d.cover)}" alt="3:4 短视频首图"><a class="download" href="/api/projects/${p.id}/export?file=cover3x4" download>下载 3:4 首图</a></section></div><section class="panel" style="margin-top:22px"><div class="row between wrap"><h3>小红书发布内容</h3><button class="primary" data-action="copy-social" data-part="all">一键复制全部</button></div>${[['title','标题',d.title],['body','正文',d.body],['tags','标签',d.tags.map(t=>'#'+t).join(' ')]].map(([k,label,value])=>`<label class="field" style="margin-top:18px"><span>${label}</span><textarea readonly rows="${k==='body'?7:2}" id="social-${k}">${esc(value)}</textarea></label><button class="small" data-action="copy-social" data-part="${k}">复制${label}</button>`).join('')}</section>`;
 return heading('开始制作','粘贴文案，选择声音。其余自动完成。')+`<section class="panel"><label class="field"><span>完整口播文案</span><textarea class="script-area" data-field="script" placeholder="粘贴你的文案…" ${disable()}>${esc(p.script)}</textarea></label><label class="field"><span>配音音色</span><select data-field="voice" ${disable()}>${state.voices.map(v=>`<option value="${v.id}" ${p.voice===v.id?'selected':''}>${v.name} · ${v.gender} · ${v.style}</option>`).join('')}</select></label><div class="row between wrap"><button data-action="listen" data-id="${p.voice}">▷ 试听所选声音</button><button class="primary" data-action="task" data-kind="workflow" ${disable()}>${p.scenes.length?'继续制作，完成后验收':'开始制作，完成后验收'} →</button></div><p class="hint" style="margin-top:16px">语速 ${p.speed} 倍 · 制作中可关闭页面，保持电脑运行即可。</p><button class="quiet small" data-action="tab" data-tab="script">高级编辑与参数</button></section>`;
}
function voicesView(){
 const v=state.voices.find(v=>v.id===p.voice);
 return heading('给故事，选一种声音','先听一听，再选择适合这条作品的表达。','<span class="badge">6 款中文音色</span>')+`<div class="voices-layout"><section><div class="voices-grid">${state.voices.map((v,i)=>`<article class="voice ${p.voice===v.id?'selected':''} ${playing===v.id?'playing':''}" data-voice="${v.id}"><div class="voice-header"><div class="avatar">${v.name.slice(-1)}</div><div><div class="voice-name">${v.name}</div><div class="voice-desc">${v.gender} · ${v.style}</div></div></div><div class="wave" aria-hidden="true">${Array.from({length:29},(_,k)=>`<i style="--h:${8+((k*17+i*9)%27)}px;--i:${k}"></i>`).join('')}</div><div class="voice-footer"><button data-action="listen" data-id="${v.id}" aria-label="试听${v.name}">${playing===v.id?'Ⅱ 暂停':'▷ 试听'}</button><button data-action="voice" data-id="${v.id}" aria-pressed="${p.voice===v.id}" class="${p.voice===v.id?'chosen':''}" ${disable()}>${p.voice===v.id?'✓ 已选用':'选用声音'}</button></div></article>`).join('')}</div><p class="voice-caption">AI 合成音色 · 试听使用统一文案与 1.2 倍速，音色描述参考服务标签。</p><div class="sample-text"><span class="eyebrow">试听文案</span><p>“明明刷了很多题，为什么一换题型，还是不知道从哪下手？<br>先别急着做下一套。回头看看，这一道题，你究竟卡在哪一步。”</p></div></section><aside class="panel settings-panel"><div class="row between section-title"><h3>本片配音</h3><span class="badge blue">${esc(v.name)}</span></div><div class="voice-settings"><div><label class="field"><span>语速</span><div class="speed-value" id="speed-value">${p.speed.toFixed(1)}<span style="font-size:13px;letter-spacing:0"> ×</span></div><input aria-label="语速" data-field="speed" type="range" min="0.8" max="1.5" step="0.1" value="${p.speed}" ${disable()}><div class="range-labels"><span>0.8 慢一些</span><span>1.5 快一些</span></div><small>生成时保留音调，按实际语音重排字幕与镜头。</small></label></div><div><div class="divider"></div><label class="field"><span>配音范围</span><small>${p.scenes.length} 个镜头 · ${p.scenes.reduce((n,s)=>n+s.text.length,0)} 字旁白<br>声音将应用到整条作品。</small></label><button class="primary full" data-action="task" data-kind="speech" ${!p.scenes.length||busy()?'disabled':''}>生成本片配音</button>${p.speech?`<p class="hint" style="margin-top:12px">${p.speechCurrent?'当前配音':'旧版配音 · 需要重新生成'}</p><audio class="audio-preview" controls src="${media(p.speech.audio)}"></audio>`:''}</div></div></aside></div>`;
}
function scriptView(){return heading('从一个想法，写成一个故事','粘贴完整文案，或输入主题，让本机 GPT 帮你起草。')+`<div class="script-layout"><section class="panel"><label class="field"><span>作品名称 / 主题</span><input type="text" data-field="title" value="${esc(p.title)}" maxlength="100" ${disable()}></label><label class="field"><span>口播文案</span><textarea class="script-area" data-field="script" placeholder="写下你要讲的内容。会按句意和语速拆成短镜头，长段落会继续细拆。" ${disable()}>${esc(p.script)}</textarea></label><div class="toolbar"><span class="hint">${p.script.length} 字 · 自动保存</span><div class="row wrap"><button data-action="task" data-kind="draft" ${disable()}>✧ GPT 起草文案</button><button class="primary" data-action="split" ${disable()}>按节奏拆分镜 →</button></div></div></section><aside><div class="panel"><h3 class="section-title">画面风格</h3><textarea data-field="style" rows="7" ${disable()}>${esc(p.style)}</textarea><p class="hint" style="margin-top:14px">描述人物、服装、线条与光线。出图会使用已有镜头作参考。</p><div class="divider"></div><h3>接下来</h3><ol class="note-list"><li>拆分或用 GPT 规划分镜</li><li>选择音色与语速</li><li>生成或导入分镜图片</li><li>合成并预览完整视频</li></ol><button class="full" data-action="task" data-kind="storyboard" ${!p.script.trim()||busy()?'disabled':''}>✧ GPT 规划分镜</button><button style="margin-top:10px" class="primary full" data-action="task" data-kind="workflow" ${disable()}>开始完整制作</button><p class="hint" style="margin-top:10px">使用本机 GPT 订阅、在线配音与本地合成。缺图会逐张生成。</p></div></aside></div>`;}
function scenesView(){
 if(!p.scenes.length)return heading('分镜制作','先把文案拆成镜头，再准备画面。')+`<div class="panel empty"><h2>还没有分镜</h2><p>回到文案页，按节奏拆分，或让 GPT 规划。</p><br><button class="primary" data-action="tab" data-tab="script">编辑文案</button></div>`;
 const s=p.scenes[selected];
 return heading('让每一句话，都有画面',`${p.scenes.length} 个镜头 · ${p.scenes.filter(s=>s.image).length} 张图片已准备 · 按句意与语速拆分`, `<button data-action="task" data-kind="images" ${disable()}>✧ 生成缺失画面（${p.scenes.filter(s=>!s.image&&!s.locked).length}）</button>`)+`<div class="boards"><div><section class="scene-grid">${p.scenes.map((s,i)=>`<button class="scene-card ${i===selected?'selected':''}" data-action="scene" data-index="${i}">${s.image?`<img src="${media(s.image)}" alt="镜头${i+1}画面">`:'<div class="placeholder">＋ 等待生成或导入画面</div>'}<div class="scene-meta"><div class="row between"><span class="shot-number">${String(i+1).padStart(2,'0')}</span><span class="badge">${s.locked?'已锁定':s.image?'画面就绪':'缺少图片'}</span></div><p>${esc(s.text)||'请填写旁白'}</p></div></button>`).join('')}</section><div class="scene-bottom"><button data-action="add" ${disable()}>＋ 添加镜头</button><div class="row"><button data-action="tab" data-tab="voices">选择声音</button><button class="primary" data-action="task" data-kind="render" ${disable()}>合成并预览 →</button></div></div></div><aside class="panel shot-side"><div class="row between section-title"><h3>当前镜头</h3><span class="badge blue">${String(selected+1).padStart(2,'0')} / ${p.scenes.length}</span></div><label class="field"><span>对应台词</span><textarea data-scene-field="text" rows="3" ${disable()}>${esc(s.text)}</textarea></label><label class="field"><span>画面描述</span><textarea data-scene-field="prompt" rows="5" placeholder="谁在什么场景，正在做什么？" ${disable()}>${esc(s.prompt)}</textarea></label><label class="field"><span>进入此镜头的转场</span><select data-scene-field="transition" ${disable()}>${Object.entries({auto:'跟随全片规则',dissolve:'柔和叠化',push:'轻推接镜',blur:'模糊过渡',slide:'同向滑动',match:'构图匹配直切（需人工核对）',cut:'直接切换'}).map(([k,v])=>`<option value="${k}" ${(s.transition||'auto')===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>运镜</span><select data-scene-field="motion" ${disable()}>${Object.entries(motionNames).map(([k,v])=>`<option value="${k}" ${(s.motion==='still'?'still':'push')===k?'selected':''}>${v}</option>`).join('')}</select></label><div class="image-actions"><button data-action="upload" ${s.locked||busy()?'disabled':''}>导入图片</button><button data-action="task" data-kind="images" data-scene="${s.id}" ${s.locked||busy()?'disabled':''}>${s.image?'重做此图':'生成此图'}</button></div><label class="checkbox" style="margin-top:16px"><input type="checkbox" data-scene-field="locked" ${s.locked?'checked':''} ${disable()}>锁定此镜头图片</label>${s.versions.length?`<label class="field" style="margin-top:18px"><span>图片版本</span><select id="image-version" ${s.locked||busy()?'disabled':''}>${s.versions.map((v,i)=>`<option value="${esc(v.file)}" ${s.image===v.file?'selected':''}>版本 ${i+1} · ${esc(v.label)}</option>`).join('')}</select></label>`:''}<div class="divider"></div><div class="row"><button class="small" data-action="move" data-direction="-1" ${selected===0||busy()?'disabled':''}>向前移</button><button class="small" data-action="move" data-direction="1" ${selected===p.scenes.length-1||busy()?'disabled':''}>向后移</button><button class="small quiet danger" data-action="remove" ${disable()}>移除</button></div></aside></div>`;
}
function previewView(){
 const r=p.renders.find(x=>x.id===version)||p.renders.at(-1);const old=r&&(r.id!==p.renders.at(-1)?.id||!p.renderCurrent);
 return heading('看一遍，打磨最后的细节','横屏 1920 × 1080 · 30 帧 · 配音、字幕、开场与转场特效')+(old?'<div class="notice warn">当前播放的是旧版成片。文案、声音或画面有更新，请重新合成后导出。</div>':'')+`<div class="preview-layout"><section><div class="player">${r?`<video id="film" controls playsinline preload="metadata" src="${media(r.video)}"></video>`:'<div class="empty"><h2>你的故事，准备登场</h2><p>准备好分镜图片后，点击“生成视频”。</p></div>'}</div><div class="timeline"><div class="row between"><span class="hint">${r?`${r.duration.toFixed(1)} 秒 · ${new Date(r.created).toLocaleString('zh-CN')}`:'尚未生成成片'}</span><span class="badge">${r?`版本 ${p.renders.indexOf(r)+1}`:'预览'}</span></div><div class="timeline-row"><span class="track-label">画面</span><div class="track">${p.scenes.map((s,i)=>`<button data-action="seek" data-index="${i}" title="镜头 ${i+1}">${s.image?`<img src="${media(s.image)}" alt="镜头 ${i+1}">`:i+1}</button>`).join('')}</div></div><div class="timeline-row"><span class="track-label">配音</span><div class="track audio-track">${esc(state.voices.find(v=>v.id===(r?.voice||p.voice))?.name)} · ${r?.speed||p.speed} 倍速</div></div><div class="timeline-row"><span class="track-label">字幕</span><div class="track audio-track caption-track">中文字幕 · ${p.subtitle.enabled?'开启':'关闭'}</div></div></div></section><aside class="panel"><h3 class="section-title">开场特效</h3><label class="checkbox"><input type="checkbox" data-opening-field="enabled" ${p.opening?.enabled?'checked':''} ${disable()}>B5 分条开场 · 图片慢慢放大</label><label class="field"><span>开场标题</span><textarea aria-label="开场标题" maxlength="40" rows="2" data-opening-field="title" placeholder="留空提取首句，建议填写最吸引人的结论" ${disable()}>${esc(p.opening?.title||'')}</textarea><small>最长 4 秒，随首镜头自动缩短并淡出。</small></label><div class="divider"></div><h3 class="section-title">音效</h3><label class="checkbox"><input type="checkbox" data-sfx-field="enabled" ${p.sfx?.enabled?'checked':''} ${disable()}>B5 单声“噔”＋渐弱长尾（转场无音效）</label><label class="field"><span>音效音量（0–30%）</span><input aria-label="音效音量" type="number" min="0" max="30" step="1" data-sfx-field="volume" value="${Math.round((p.sfx?.volume??.12)*100)}" ${disable()}><small>12% 对应已确认的 B5 音效音量，配音保持原音量。更改后重新合成生效。</small></label><div class="divider"></div><p class="hint">配音自动清理首尾空白，超过 0.45 秒的静音压缩至约 0.28 秒，字幕同步更新。</p><div class="divider"></div><h3 class="section-title">画面转场</h3><label class="field"><span>切换方式</span><select data-transition-field="type" ${disable()}>${Object.entries({auto:'按段落自动选择',dissolve:'柔和叠化',push:'轻推接镜',blur:'模糊过渡',slide:'同向滑动',match:'构图匹配直切（需人工核对）',cut:'直接切换'}).map(([k,v])=>`<option value="${k}" ${(p.transition?.type||'auto')===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>转场时长（秒）</span><input aria-label="转场时长" type="number" min="0.2" max="0.8" step="0.1" data-transition-field="duration" value="${p.transition?.duration||0.4}" ${disable()}><small>图片统一慢慢放大，无回缩或二次推近。建议转场 0.4 秒，只调整画面衔接，不改变旁白和字幕时间。</small></label><div class="divider"></div><h3 class="section-title">字幕设置</h3><p class="hint">默认白字黑边，按完整短句显示。</p><label class="checkbox"><input type="checkbox" data-subtitle-field="enabled" ${p.subtitle.enabled?'checked':''} ${disable()}>显示中文字幕</label><div class="row between" style="margin:20px 0"><span style="font-size:12px">文字颜色</span><input aria-label="字幕颜色" type="color" data-subtitle-field="color" value="${p.subtitle.color}" ${disable()}></div><label class="field"><span>字号</span><input aria-label="字幕字号" type="number" min="36" max="76" data-subtitle-field="size" value="${p.subtitle.size}" ${disable()}></label><button class="primary full" data-action="task" data-kind="render" ${disable()}>${r?'重新合成':'生成视频'}</button><div class="divider"></div><h3>导出作品</h3>${r&&!old?['video','srt','cover','publish'].filter(k=>r[k]).map(k=>`<a class="download" href="/api/projects/${p.id}/export?version=${r.id}&file=${k}" download>${{video:'下载 MP4 成片',srt:'下载字幕 SRT',cover:'下载封面画面',publish:'下载文案'}[k]} ↓</a>`).join(''):'<p class="hint" style="margin-top:12px">最新成片生成后，可导出视频、字幕、封面画面与文案。</p>'}${p.renders.length?'<div class="divider"></div><h3>历史成片</h3>'+p.renders.slice().reverse().map((v,i)=>`<button class="version ${r?.id===v.id?'active':''}" data-action="version" data-id="${v.id}">版本 ${p.renders.length-i} · ${v.duration.toFixed(1)} 秒<span class="muted"> · ${v.speed}×</span></button>`).join(''):''}</aside></div>`;
}
function projectsView(){
 const enabled=!!state.concurrency;
 const eligible=state.projects.filter(batchEligible);
 for(const id of batchSelection)if(!eligible.some(x=>x.id===id))batchSelection.delete(id);
 return heading('我的作品','查看已生成的成片，或选择多个作品加入制作队列。','<button class="primary" data-action="new">＋ 新建作品</button>')+(enabled?`<div class="batch-toolbar"><div class="row wrap"><button data-action="batch-all" ${!eligible.length?'disabled':''}>${eligible.length&&batchSelection.size===eligible.length?'取消全选':'全选可制作作品'}</button><span class="hint">已选 ${batchSelection.size} 个 · 逐条制作 · 当前作品同时出 2 张图</span></div><button class="primary" data-action="batch-submit" ${!batchSelection.size||batchSubmitting?'disabled':''}>${batchSubmitting?'正在加入…':'批量加入队列'}</button></div>`:'<div class="notice warn">并发功能将在服务安全更新后启用，当前任务继续按原方式制作。</div>')+`<div class="project-grid">${state.projects.slice().reverse().map(x=>{
  const job=state.jobs.find(j=>j.projectId===x.id&&['queued','running','cancelling','waiting'].includes(j.state));
  const hasVideo=!!x.renders.at(-1)?.video;
  const status=job?`${jobNames[job.state]}${hasVideo?' · 已有成片':''}`:x.renderCurrent?'已完成 · 成片就绪':hasVideo?'已有成片 · 可更新':x.scenes.length?'待完成':'草稿';
  const label=job?'查看进度':hasVideo?'查看成片':'继续制作';
  const target=job||!hasVideo?'simple':'preview';
  const image=x.scenes.find(s=>s.image)?.image;
  return `<article class="project-card clickable-card" data-card-open data-action="open" data-id="${x.id}" data-tab="${target}" role="link" tabindex="0" aria-label="${esc(label)}：${esc(x.title)}">${image?`<img src="${media(image)}" alt="${esc(x.title)}封面">`:'<div class="placeholder">新故事</div>'}<div class="project-card-body">${enabled?`<button class="batch-choice" data-action="batch-toggle" data-id="${x.id}" aria-pressed="${batchSelection.has(x.id)}" ${!batchEligible(x)||batchSubmitting?'disabled':''}>${batchSelection.has(x.id)?'☑ 已选择':'□ 选择制作'}</button>`:''}<h3>${esc(x.title)}</h3><p>${x.scenes.length} 个镜头 · ${status}</p><div class="row"><button class="primary small" data-action="open" data-tab="${target}" data-id="${x.id}">${label}</button>${hasVideo?`<button class="small" data-action="open" data-id="${x.id}">编辑作品</button>`:''}<button class="small" data-action="copy" data-id="${x.id}">复制</button><button class="quiet small danger" data-action="delete-project" data-id="${x.id}" ${job?'disabled':''}>删除</button></div></div></article>`;
 }).join('')}</div>`;
}
function jobsView(){
 const paused=state.concurrency?.queuePause,groups=groupJobs(state.jobs);
 const running=groups.filter(g=>['running','cancelling'].includes(g.current.state)),queued=groups.filter(g=>g.current.state==='queued');
 return heading('制作任务','每个作品显示一张卡片，可展开查看历史制作记录。','<button data-action="screen" data-screen="projects">选择作品批量制作</button>')+`<div class="queue-summary"><span>作品 <strong>${groups.length}</strong></span><span>制作中 <strong>${running.length} / ${state.concurrency?.videos||1}</strong></span><span>排队 <strong>${queued.length}</strong></span></div>`+(paused?`<div class="notice warn"><strong>队列等待恢复</strong><p>${esc(paused.message)} · 下次检查 ${new Date(paused.nextCheckAt).toLocaleTimeString('zh-CN')}</p><button data-action="resume-queue">现在重试</button></div>`:'')+(state.concurrency?.memoryCritical?'<div class="notice warn">内存压力较高，暂缓启动新视频和渲染。正在处理的步骤继续运行，恢复后自动推进。</div>':'')+(groups.length?groups.map(({projectId,current:j,history})=>{
 const project=state.projects.find(x=>x.id===projectId),title=project?.title||'作品',live=['running','queued','cancelling','waiting'].includes(j.state);
 const target=!live&&project?.renders.at(-1)?.video?'preview':'simple',label=target==='preview'?'查看成片':'查看作品进度';
 return `<article class="job job-project clickable-card" data-card-open data-action="open" data-id="${projectId}" data-tab="${target}" role="link" tabindex="0" aria-label="${esc(label)}：${esc(title)}"><div class="row between wrap"><div class="job-title">${esc(title)}</div><span class="badge ${j.state==='failed'?'amber':''}">${jobNames[j.state]}${live?` · ${j.progress||0}%`:''}</span></div><div class="job-msg">${esc(kindNames[j.kind]||j.kind)} · ${esc(j.message)}</div>${live?branchStatus(j)+`<div class="progress" role="progressbar" aria-label="${esc(title)}制作进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${j.progress||0}"><i style="width:${j.progress||0}%"></i></div>`:''}<div class="row between wrap job-actions"><span class="hint">${new Date(j.created).toLocaleString('zh-CN')} · ${recordTime(j)}</span><div class="row wrap"><button class="small" data-action="open" data-id="${projectId}" data-tab="${target}">${label}</button>${['running','queued','waiting'].includes(j.state)?`<button class="small" data-action="cancel" data-id="${j.id}">停止此任务</button>`:['failed','cancelled','interrupted'].includes(j.state)?`<button class="small" data-action="retry" data-id="${j.id}">继续制作</button>`:''}</div></div>${history.length?`<details class="job-history" data-project-history="${esc(projectId)}"><summary>历史制作记录（${history.length}）</summary>${history.map(old=>`<div class="job-history-row"><div><strong>${esc(kindNames[old.kind]||old.kind)}</strong><span class="badge">${esc(jobNames[old.state]||old.state)}</span></div><span class="hint">${new Date(old.created).toLocaleString('zh-CN')} · ${recordTime(old)}</span></div>`).join('')}</details>`:''}</article>`;
 }).join(''):'<div class="panel empty">还没有制作任务</div>');
}
function settingsView(){return heading('连接与设置','分别检查登录、文字、图片和本地制作能力。','<button data-action="health">重新检查</button>')+`<div class="connection-grid"><div class="panel"><h3>GPT 订阅</h3><span class="badge ${health?.login?'blue':'amber'}">${health?.login?'本机已登录':'尚未确认登录'}</span><p>文案与分镜：${state.capabilities?.text?.ok?'已验证':'待首次任务验证'}<br>图片生成：${state.capabilities?.image?.ok?'已验证':state.capabilities?.image?.ok===false?'最近生成失败':'待首次任务验证'}<br>${subscriptionCurrent()}</p></div><div class="panel"><h3>中文配音</h3><span class="badge ${health?.tts?'blue':'amber'}">${health?.tts?'配音工具可用':'需要检查配音工具'}</span><p>6 款中文 AI 音色<br>使用在线合成服务，需要联网。<br>试听与本片声音在“声音”页选择。</p></div><div class="panel"><h3>视频合成</h3><span class="badge ${health?.render?'blue':'amber'}">${health?.render?'本机工具就绪':'需要检查渲染工具'}</span><p>1920 × 1080 · 30 帧<br>MP4、字幕、封面画面、文案<br>生成记录与历史版本保存在本地。</p></div></div><div class="panel"><h3>运行方式</h3><p class="hint" style="margin-top:14px">工作台服务运行时，关闭浏览器不会停止任务；退出工作台服务或关闭电脑会暂停制作；重新打开后，完整制作队列会自动从已有素材继续。<br>不会自动改用付费图片接口，也不会自动发布作品。图片能力暂不可用时，可以导入本机图片继续完成视频。</p></div>`;}
async function refresh(force=false){
 const next=await api('/api/state');const old=state;
 const removed=!!p&&!next.projects.some(x=>x.id===p.id);
 if(removed)clearProject();
 if(dirty||saving){state=next;if(removed)render();return;}
 const projectChanged=next.projects.find(x=>x.id===p?.id);
 const changedData=removed||!old||JSON.stringify([next.projects,next.jobs,next.capabilities])!==JSON.stringify([old.projects,old.jobs,old.capabilities]);
 state=next;if(projectChanged){p=structuredClone(projectChanged);selected=Math.min(selected,Math.max(0,p.scenes.length-1));}else if(!p&&next.projects.length)setProject(next.projects[0]);
 if(changedData||force)render();
}
async function task(kind,sceneId){await save();const j=await api(`/api/projects/${p.id}/tasks`,{method:'POST',body:{kind,sceneId}});state.jobs.push(j);render();toast('任务已开始，进度会显示在上方');}
document.addEventListener('keydown',event=>{
 if(!event.target.matches('[data-card-open]')||!['Enter',' '].includes(event.key))return;
 event.preventDefault();event.target.click();
});
document.addEventListener('click',async event=>{
 const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
 if(el.hasAttribute('data-card-open')&&event.target.closest('button,a,input,textarea,select,details,summary,[contenteditable]'))return;
 const action=el.dataset.action;
 try{
  if(action==='batch-toggle'){if(batchSubmitting)return;const x=state.projects.find(x=>x.id===el.dataset.id);if(x&&batchEligible(x)){batchSelection.has(x.id)?batchSelection.delete(x.id):batchSelection.add(x.id);render();}return;}
  if(action==='batch-all'){const eligible=state.projects.filter(batchEligible);if(batchSelection.size===eligible.length)batchSelection.clear();else eligible.forEach(x=>batchSelection.add(x.id));render();return;}
  if(action==='batch-submit'){
    if(batchSubmitting||!batchSelection.size)return;
    await save();batchSubmitting=true;const ids=[...batchSelection];render();
    try{const result=await api('/api/tasks/batch',{method:'POST',body:{projectIds:ids}});result.accepted.forEach(j=>batchSelection.delete(j.projectId));
      screen='jobs';await refresh(true);toast(`已加入 ${result.accepted.length} 个任务`+(result.skipped.length?`；${result.skipped.map(x=>(state.projects.find(p=>p.id===x.projectId)?.title||'作品')+'：'+x.error).join('；')}`:''));
    }finally{batchSubmitting=false;render();}return;
  }
  if(action==='copy-social'){const d=p.renders.at(-1)?.delivery;if(!d)throw Error('发布内容尚未完成');const tags=d.tags.map(t=>'#'+t).join(' ');const text=el.dataset.part==='all'?`${d.title}\n\n${d.body}\n\n${tags}`:el.dataset.part==='tags'?tags:d[el.dataset.part];try{await navigator.clipboard.writeText(text);toast('已复制，可直接粘贴发布');}catch{const field=$('#social-'+(el.dataset.part==='all'?'body':el.dataset.part));field?.select();toast('浏览器未允许复制，请复制已选中的文字');}return;}
  if(action==='listen'){
    const v=state.voices.find(v=>v.id===el.dataset.id);
    if(playing===v.id){sample.pause();playing=null;}else{sample.pause();sample.src='/assets/voices/'+encodeURIComponent(v.sample);await sample.play();playing=v.id;}
    document.querySelectorAll('[data-voice]').forEach(card=>{const on=card.dataset.voice===playing;card.classList.toggle('playing',on);card.querySelector('[data-action="listen"]').textContent=on?'Ⅱ 暂停':'▷ 试听';});return;
  }
  if(action==='delete-project'){
   const target=state.projects.find(x=>x.id===el.dataset.id);if(!target)return;
   deleteTargetId=target.id;$('#delete-title').textContent=target.title;$('#delete-dialog').showModal();return;
 }
 if(action==='cancel-delete'){$('#delete-dialog').close();deleteTargetId=null;return;}
 if(action==='confirm-delete'){
   if(deleting||!deleteTargetId)return;deleting=true;el.disabled=true;
   try{await save();const id=deleteTargetId;const result=await api(`/api/projects/${id}`,{method:'DELETE'});batchSelection.delete(id);if(p?.id===id)clearProject();$('#delete-dialog').close();deleteTargetId=null;await refresh(true);toast(result.cleanupWarning?'作品已删除，部分素材暂未清除':'作品及相关记录已删除');}
   finally{deleting=false;el.disabled=false;}return;
 }
 if(action==='new'){await save();const next=await api('/api/projects',{method:'POST',body:{title:'未命名作品'}});state.projects.push(next);setProject(next);screen='editor';tab='simple';render();return;}
  if(action==='close-dialog'){$('#new-dialog').close();return;}
  if(action==='voice'){p.voice=el.dataset.id;p.speechCurrent=false;p.renderCurrent=false;changed();render();return;}
  if(action==='save'){await save();toast('已保存');return;}
  if(action==='task'){await task(el.dataset.kind,el.dataset.scene);return;}
  if(action==='resume-queue'){await api('/api/queue/resume',{method:'POST'});await refresh(true);return;}
  if(action==='cancel'){await api(`/api/jobs/${el.dataset.id}/cancel`,{method:'POST'});await refresh(true);return;}
  if(action==='retry'){await save();const j=state.jobs.find(j=>j.id===el.dataset.id);const result=await api(`/api/projects/${j.projectId}/tasks`,{method:'POST',body:{kind:j.kind,sceneId:j.sceneId}});state.jobs.push(result);render();return;}
  await save();
  if(action==='tab'){sample.pause();playing=null;tab=el.dataset.tab;localStorage.setItem('story-tab',tab);screen='editor';}
  if(action==='screen')screen=el.dataset.screen;
  if(action==='open'){setProject(state.projects.find(x=>x.id===el.dataset.id));screen='editor';tab=el.dataset.tab||'simple';}
  if(action==='scene')selected=Number(el.dataset.index);
  if(action==='split'){const next=await api(`/api/projects/${p.id}/split`,{method:'POST'});setProject(next);tab='scenes';await refresh();}
  if(action==='add'){setProject(await api(`/api/projects/${p.id}/add-scene`,{method:'POST'}));selected=p.scenes.length-1;await refresh();}
  if(action==='move'){const target=selected+Number(el.dataset.direction);[p.scenes[selected],p.scenes[target]]=[p.scenes[target],p.scenes[selected]];selected=target;p.script=p.scenes.map(s=>s.text).join('\n\n');changed();}
  if(action==='remove'){p.scenes.splice(selected,1);selected=Math.max(0,selected-1);p.script=p.scenes.map(s=>s.text).join('\n\n');changed();}
  if(action==='upload'){uploadScene=p.scenes[selected].id;$('#image-upload').click();return;}
  if(action==='version')version=el.dataset.id;
  if(action==='copy'){const copy=await api(`/api/projects/${el.dataset.id}/copy`,{method:'POST'});state.projects.push(copy);setProject(copy);screen='editor';toast('已创建独立副本');}
  if(action==='health'){health=await api('/api/health?refresh=1');toast('连接状态已更新');}
  if(action==='seek'){const i=Number(el.dataset.index),s=p.speech?.scenes[i];if($('#film')&&s&&p.renderCurrent){$('#film').currentTime=s.start+((p.renders.find(v=>v.id===version)||p.renders.at(-1))?.voiceOffset||0);return;}selected=i;tab='scenes';}
  render();
 }catch(e){toast(e.message);}
});
document.addEventListener('input',event=>{
 const e=event.target;if(!p||busy())return;
 if(e.dataset.field){const k=e.dataset.field;p[k]=k==='speed'?Number(e.value):e.value;if(k==='speed')$('#speed-value').innerHTML=p.speed.toFixed(1)+'<span style="font-size:13px"> ×</span>';p.renderCurrent=false;changed();if(k==='voice')render();}
 if(e.dataset.sceneField){const k=e.dataset.sceneField;p.scenes[selected][k]=k==='locked'?e.checked:e.value;if(k==='text')p.script=p.scenes.map(s=>s.text).join('\n\n');p.renderCurrent=false;changed();}
 if(e.dataset.openingField){const k=e.dataset.openingField;p.opening||={enabled:false,title:''};p.opening[k]=k==='enabled'?e.checked:e.value;p.renderCurrent=false;changed();}
 if(e.dataset.sfxField){const k=e.dataset.sfxField;p.sfx||={enabled:false,volume:.12};p.sfx[k]=k==='enabled'?e.checked:Number(e.value)/100;p.renderCurrent=false;changed();}
 if(e.dataset.transitionField){const k=e.dataset.transitionField;p.transition||={type:'cut',duration:0.4};p.transition[k]=k==='duration'?Number(e.value):e.value;p.renderCurrent=false;changed();}
 if(e.dataset.subtitleField){const k=e.dataset.subtitleField;p.subtitle[k]=k==='enabled'?e.checked:k==='size'?Number(e.value):e.value;p.renderCurrent=false;changed();}
});
document.addEventListener('change',async event=>{try{
 if(event.target.id==='image-version'){await save();const next=await api(`/api/projects/${p.id}/scenes/${p.scenes[selected].id}/version`,{method:'POST',body:{file:event.target.value}});p=next;await refresh(true);}
 if(event.target.dataset.sceneField==='locked'){await save();render();}
}catch(e){toast(e.message);}});
$('#image-upload').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;
 try{if(file.size>20*1024*1024)throw Error('图片不能超过 20 MB');await save();const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});await api(`/api/projects/${p.id}/scenes/${uploadScene}/image`,{method:'POST',body:{image:data}});await refresh(true);toast('图片已导入，旧版本已保留');}catch(e){toast(e.message);}finally{event.target.value='';}
});
$('#new-form').addEventListener('submit',async event=>{event.preventDefault();try{await save();const title=new FormData(event.target).get('title');const next=await api('/api/projects',{method:'POST',body:{title}});state.projects.push(next);setProject(next);screen='editor';tab='simple';$('#new-dialog').close();event.target.reset();render();}catch(e){toast(e.message);}});
sample.addEventListener('ended',()=>{playing=null;document.querySelectorAll('[data-voice]').forEach(c=>{c.classList.remove('playing');c.querySelector('[data-action="listen"]').textContent='▷ 试听';});});
sample.addEventListener('error',()=>{playing=null;toast('试听加载失败，请检查文件');});
document.addEventListener('play',e=>{if(e.target instanceof HTMLMediaElement){sample.pause();playing=null;document.querySelectorAll('audio,video').forEach(v=>{if(v!==e.target)v.pause();});}},true);
window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
try{state=await api('/api/state');const target=state.projects.find(p=>p.id===localStorage.getItem('story-project'))||state.projects[0];if(target)setProject(target);render();health=await api('/api/health');render();}catch(e){$('#app').innerHTML=`<div class="empty"><h2>工作台暂时无法连接</h2><p>${esc(e.message)}</p><button onclick="location.reload()">重新连接</button></div>`;}
setInterval(()=>refresh().catch(()=>{}),1800);

setInterval(updateDurationDisplays,1000);
