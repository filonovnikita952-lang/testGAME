(() => {
 const root=document.querySelector('#skill-import'), form=document.querySelector('#import-upload'), status=document.querySelector('#import-status');
 let preview=null, mode=null, sequence=0;
 const post=async(url,body,json=false)=>{
  const r=await fetch(url,{method:'POST',headers:{'X-Import-CSRF':root.dataset.csrf,...(json?{'Content-Type':'application/json'}:{})},body:json?JSON.stringify(body):body});
  const data=await r.json();if(!r.ok)throw Error(data.error || 'Помилка імпорту');return data;
 };
 async function check(body) {
  const version=++sequence;
  preview=null;document.querySelector('#import-preview').hidden=true;status.textContent='Перевірка…';
  try {
   const data=await post('/admin/skills/import/preview',body);if(version!==sequence)return;preview=data;document.querySelector('#import-confirm').disabled=false;mode=body.get('mode');
   document.querySelector('#import-edit').value=JSON.stringify(data.records,null,2);
   document.querySelector('#import-counts').textContent=`Усього: ${data.rows.length}; нових: ${data.counts.new}; оновлень: ${data.counts.update}; дублікатів: ${data.counts.duplicate}; помилок: ${data.counts.error}`;
   const rows=document.querySelector('#import-rows');rows.replaceChildren();
   data.rows.forEach((row,index)=>{
    const tr=document.createElement('tr'),td=document.createElement('td'),input=document.createElement('input');input.type='checkbox';input.value=index;input.setAttribute('aria-label',`Імпортувати ${row.record.name}`);input.disabled=!['new','update'].includes(row.status);input.checked=!input.disabled;td.append(input);tr.append(td);
    for(const value of [row.record.class,row.record.subclass,row.record.branch,row.record.level,row.record.name,({new:'Новий',update:'Оновлення',duplicate:'Дублікат',error:'Помилка'}[row.status])+' '+[...row.errors,...row.warnings].join('; ')]) { const cell=document.createElement('td');cell.textContent=value;tr.append(cell); }
    rows.append(tr);
   });document.querySelector('#import-preview').hidden=false;status.textContent='Перевірте записи перед підтвердженням.';
  }catch(e){status.textContent=e.message;}
 }
 document.querySelector('#import-edit').addEventListener('input',()=>{preview=null;sequence++;document.querySelector('#import-confirm').disabled=true;status.textContent='Перевірте виправлення перед підтвердженням.';});
 form.elements.mode.addEventListener('change',()=>{preview=null;sequence++;document.querySelector('#import-preview').hidden=true;status.textContent='Режим змінено. Повторіть перегляд.';});
 form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;await check(new FormData(form));button.disabled=false;});
 document.querySelector('#import-recheck').onclick=async()=>{const body=new FormData();body.set('mode',form.elements.mode.value);body.set('file',new Blob([document.querySelector('#import-edit').value],{type:'application/json'}),'edited.json');await check(body);};
 document.querySelector('#import-confirm').onclick=async e=>{
  if(!preview)return;const button=e.target;button.disabled=true;
  try {const result=await post('/admin/skills/import/confirm',{records:preview.records,token:preview.token,mode,selected:[...document.querySelectorAll('#import-rows input:checked')].map(e=>Number(e.value))},true);preview=null;status.textContent=`Імпортовано: ${result.imported}. Нових: ${result.created}, оновлено: ${result.updated}. `;const link=document.createElement('a');link.textContent='Завантажити резервну копію';link.href='/admin/skills/import/backup/'+result.backup;status.append(link);document.querySelector('#import-preview').hidden=true;}
  catch(error){status.textContent=error.message;}finally{button.disabled=false;}
 };
})();
