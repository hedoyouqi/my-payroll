(function () {
  'use strict';
  const C=window.PayCalc, $=(s)=>document.querySelector(s), $$=(s)=>Array.from(document.querySelectorAll(s));
  const storageKey='personal-payroll-pwa-v1';
  const now=new Date();let ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let state={version:1,records:{},defaults:{...C.DEFAULT},monthSettings:{}};
  try {const data=JSON.parse(localStorage.getItem(storageKey)||'null');if(data&&data.version===1){state={version:1,records:data.records||{},defaults:{...C.DEFAULT,...(data.defaults||{})},monthSettings:data.monthSettings||{}};}}catch(e){console.warn('저장된 기록을 읽지 못했습니다.',e);}
  let activeTab='calendar',selectedDate=null,temporaryRecord=null,toastTimer,saveButtonTimer,closeSheetTimer,countFrame=0,lastRenderedNet=null;
  const fmt=v=>Math.round(Number(v)||0).toLocaleString('ko-KR');
  const won=v=>`${fmt(v)}원`;
  const pad=n=>String(n).padStart(2,'0');
  const dateKey=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
  const labelDate=(date)=>{const [y,m,d]=date.split('-').map(Number);return `${y}년 ${m}월 ${d}일 (${['일','월','화','수','목','금','토'][new Date(y,m-1,d).getDay()]})`;};
  function save(){try{localStorage.setItem(storageKey,JSON.stringify(state));return true;}catch(e){toast('저장하지 못했어요. 기기 저장 공간을 확인하고 백업을 만드세요.');return false;}}
  function flashSaved(){const btn=$('#globalSave');if(!btn)return;btn.classList.remove('saved');void btn.offsetWidth;btn.classList.add('saved');$('#saveButtonLabel').textContent='저장됨';clearTimeout(saveButtonTimer);saveButtonTimer=setTimeout(()=>{$('#saveButtonLabel').textContent='저장';btn.classList.remove('saved');},1900);}
  function saveAll(){const ok=commitSettingInputs();if(ok===false)return; if(save()){flashSaved();toast('이 기기에 기록과 설정을 저장했어요.');}}
  function toast(msg){const node=$('#toast');node.textContent=msg;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),2800);}
  // 이 앱은 1인(공제대상 가족: 본인 1명) 자동 원천징수 전용입니다.
  // 이전 버전에서 저장한 수동 세액·보험 기준액은 화면에서 편집할 수 없으므로
  // 숨은 값이 급여에 영향을 주지 않게 자동 설정을 마지막에 적용합니다.
  const AUTOMATIC_ONLY={taxMode:'table',manualTax:0,taxPercent:100,
    pensionBasis:0,healthBasis:0,excludedInsurance:0,excludedTax:0,extraDeduction:0};
  function settings(){return {...C.DEFAULT,...state.defaults,...(state.monthSettings[ym]||{}),...AUTOMATIC_ONLY};}
  function setSetting(key,value){const merged=settings();merged[key]=value;state.monthSettings[ym]=merged;save();renderCalendar();renderSummary();renderSettingsHints();}
  function changeMonth(step){let[y,m]=ym.split('-').map(Number);let d=new Date(y,m-1+step,1);ym=`${d.getFullYear()}-${pad(d.getMonth()+1)}`;renderAll();}
  const defNum=(name,label,step=1,hint='',min=0)=>({name,label,step,hint,min});
  const fieldGroups={
    pay:[defNum('hourly','시급 (원)',10),defNum('allowance','고정수당 (원)',1000),defNum('transport','교통비 (원)',1000),defNum('extraAllowance','기타 추가수당 (원)',1000)],
    rates:[defNum('overtimeRate','잔업 배율 (1.5 = 150%)',.1),defNum('holidayRate','특근 8시간 이내 배율',.1),defNum('holidayExtraRate','특근 8시간 초과 배율',.1),defNum('nightRate','야간 추가 가산 배율',.1)],
    weekly:[defNum('weeklyDays','주휴 인정 횟수 (회)',.5),defNum('weeklyPaidHours','주휴 1회당 시간',.5)],
    adjustments:[defNum('baseAdjust','기본근로시간 보정 (+/-시간)',.5,'',-999),defNum('paidAdjust','유급시간 보정 (+/-시간)',.5,'',-999),defNum('overtimeAdjust','연장시간 보정 (+/-시간)',.5,'',-999),defNum('holidayAdjust','휴일근로시간 보정 (+/-시간)',.5,'',-999),defNum('holidayExtraAdjust','휴일 8시간 초과 보정 (+/-시간)',.5,'',-999),defNum('nightAdjust','야간시간 보정 (+/-시간)',.5,'',-999)]
  };
  const dayDefs=[defNum('base','기본근무 (시간)',.5),defNum('overtime','잔업/연장 (시간)',.5),defNum('holiday','휴일특근 8h 이내',.5),defNum('holidayExtra','휴일특근 8h 초과',.5),defNum('night','야간 추가가산 (시간)',.5),defNum('paid','유급휴가 (시간)',.5)];
  function formField(def,value,klass='setting-field'){
    const wrapper=document.createElement('label');wrapper.className='field';
    const span=document.createElement('span');span.textContent=def.label;wrapper.appendChild(span);
    const input=document.createElement('input');input.className=klass;input.type='number';input.inputMode='decimal';input.step=String(def.step);input.min=String(def.min||0);input.name=def.name;input.value=value??0;wrapper.appendChild(input);
    return wrapper;
  }
  function mountSettings(){
    const s=settings();
    for(const [name,target] of [['pay','#payFields'],['rates','#rateFields'],['weekly','#weeklyFields'],['adjustments','#adjustFields']]){
      const node=$(target);node.replaceChildren(...fieldGroups[name].map(d=>formField(d,s[d.name])));
    }
    $('#weeklyMode').value=s.weeklyMode;
    renderSettingsHints();
  }
  function renderSettingsHints(){
    const s=settings();$('#settingMonthText').textContent=`${ym.replace('-','년 ')}월에 적용 · 기기에 자동 저장`; 
    const wi=$('#weeklyFields').querySelector('[name="weeklyDays"]');wi.disabled=s.weeklyMode==='auto';wi.closest('.field').classList.toggle('disabled',s.weeklyMode==='auto');
  }
  function dayPreset(kind){
    const b={type:'work',base:0,overtime:0,holiday:0,holidayExtra:0,night:0,paid:0,note:''};
    switch(kind){case 'work8':return{...b,type:'work',base:8};
      case 'work10':return{...b,type:'work',base:8,overtime:2};
      case 'holiday8':return{...b,type:'holiday',holiday:8};
      case 'paid8':return{...b,type:'paid',paid:8};
      case 'off':return{...b,type:'off'};
      case 'absent':return{...b,type:'absent'};
      default:return{...b,type:'custom'};}
  }
  // 달력 숫자: 실제 입력 시간만 합산합니다. 야간 가산시간은 이미 근무한 시간과 중복해 세지 않습니다.
  function dayCaption(r){
    if(!r)return null;
    if(r.type==='off')return ['휴무','off'];
    if(r.type==='absent')return ['결근','absence'];
    const base=Math.max(0,Number(r.base)||0),over=Math.max(0,Number(r.overtime)||0);
    const holiday=Math.max(0,Number(r.holiday)||0)+Math.max(0,Number(r.holidayExtra)||0);
    const paid=Math.max(0,Number(r.paid)||0);
    const hours=base+over+holiday+paid;
    if(hours<=0)return ['입력','work'];
    const compact=String(Number(hours.toFixed(2))); // 8h, 10h → 8, 10
    return [compact,holiday>0?'special':paid>0&&base+over===0?'leave':over>0?'overtime':'work'];
  }
  // 하루 세전 근로수당만 표시. 월 고정수당·교통비·주휴·월별 시간 보정·공제는 제외.
  function dailyEarnings(r,s){
    if(!r||r.type==='off'||r.type==='absent')return 0;
    const num=k=>Math.max(0,Number(r[k])||0), rate=Math.max(0,Number(s.hourly)||0);
    return Math.round((num('base')+num('paid'))*rate)
      +Math.round(num('overtime')*rate*s.overtimeRate)
      +Math.round(num('holiday')*rate*s.holidayRate)
      +Math.round(num('holidayExtra')*rate*s.holidayExtraRate)
      +Math.round(num('night')*rate*s.nightRate);
  }
  function renderCalendar(){
    const[y,m]=ym.split('-').map(Number),start=new Date(y,m-1,1).getDay(),last=new Date(y,m,0).getDate();
    const node=$('#calendarGrid');node.replaceChildren();
    const s=settings(),weeklyAmounts=C.weeklySundayAmounts(state.records,ym,s);
    for(let i=0;i<start;i++){const p=document.createElement('div');p.className='calendar-blank';node.appendChild(p);}
    for(let d=1;d<=last;d++){
      const key=dateKey(y,m,d),r=state.records[key],caption=dayCaption(r);
      const weekday=new Date(y,m-1,d).getDay();
      const cell=document.createElement('button');cell.type='button';cell.className='calendar-cell';cell.dataset.date=key;
      if(weekday===0)cell.classList.add('sunday');
      if(weekday===6)cell.classList.add('saturday');
      if(y===now.getFullYear()&&m===now.getMonth()+1&&d===now.getDate())cell.classList.add('today');
      const numeral=document.createElement('span');numeral.className='daynum';numeral.textContent=d;cell.appendChild(numeral);
      if(caption){
        const chip=document.createElement('small');chip.className='day-chip '+caption[1];chip.textContent=caption[0];cell.appendChild(chip);
        const earned=dailyEarnings(r,s);
        if(earned>0){const amount=document.createElement('small');amount.className='day-amount';amount.textContent=fmt(earned);cell.appendChild(amount);}
      }else{
        const plus=document.createElement('span');plus.className='day-add';plus.textContent='+';cell.appendChild(plus);
      }
      const weekly=weeklyAmounts[key]||0;
      if(weekday===0&&weekly>0){const amount=document.createElement('small');amount.className='weekly-amount';amount.textContent='+'+fmt(weekly);cell.appendChild(amount);}
      const daily=dailyEarnings(r,s);
      cell.setAttribute('aria-label',`${labelDate(key)} ${caption?caption[0]:'기록 없음'}${daily>0?', 당일 세전 근로수당 '+won(daily):''}${weekly>0?', 주휴수당 '+won(weekly):''}`);
      cell.style.setProperty('--cell-delay',`${Math.min(d*12,280)}ms`);cell.addEventListener('click',()=>openSheet(key));node.appendChild(cell);
    }
    const extra=(7-(start+last)%7)%7;
    for(let i=0;i<extra;i++){const p=document.createElement('div');p.className='calendar-blank';node.appendChild(p);}
  }
  function openSheet(date){clearTimeout(closeSheetTimer);const sheet=$('#daySheet'),backdrop=$('#sheetBackdrop');sheet.classList.remove('closing');backdrop.classList.remove('closing');selectedDate=date;temporaryRecord={...(state.records[date]||dayPreset('work8'))};$('#sheetTitle').textContent=labelDate(date);refreshSheet();sheet.hidden=false;backdrop.hidden=false;document.body.classList.add('sheet-open');}
  function refreshSheet(){
    $('#recordType').value=temporaryRecord.type||'custom';
    $('#recordNote').value=temporaryRecord.note||'';
    $('#dayFields').replaceChildren(...dayDefs.map(def=>formField(def,temporaryRecord[def.name],'day-field')));
    const selected=temporaryRecord;
    $$('#quickPresets button').forEach(btn=>{
      const p=dayPreset(btn.dataset.preset);btn.classList.toggle('selected',Object.keys(p).every(k=>k==='note'||selected[k]===p[k]));
    });
  }
  function closeSheet(){selectedDate=null;temporaryRecord=null;const sheet=$('#daySheet'),backdrop=$('#sheetBackdrop');sheet.classList.add('closing');backdrop.classList.add('closing');document.body.classList.remove('sheet-open');clearTimeout(closeSheetTimer);closeSheetTimer=setTimeout(()=>{sheet.hidden=true;backdrop.hidden=true;sheet.classList.remove('closing');backdrop.classList.remove('closing');},190);}
  function renderSummary(){
    const result=C.payroll(state.records,ym,settings());
    $('#monthTitle').textContent=ym.replace(/^([0-9]{4})-([0-9]{2})$/,(a,y,m)=>`${y}년 ${Number(m)}월`);
    $('#monthPicker').value=ym;
    animateNet(result.net);
    $('#grossTotal').textContent=won(result.gross);$('#deductTotal').textContent=won(result.deductions);
    $('#workedDays').textContent=`${result.h.days+result.h.holidayDays}일`;
    $('#insuranceSum').textContent=won(result.insurance);
    for(const [id,key] of [['pensionPreview','pension'],['healthPreview','health'],['carePreview','care'],['employmentPreview','employment']])$('#'+id).textContent=won(result.components[key]);
    $('#insuranceNote').textContent=(Number(ym.slice(0,4))!==2026?'선택한 연도의 보험료율은 아직 검증되지 않았어요. 현재 2026년 기본 요율로 계산한 참고 금액입니다. ':'')+'현재 월 지급액 기준 예상액입니다. 회사에 신고된 보험 기준금액이 다르면 실제 공제액과 차이가 날 수 있어요. 산재보험은 회사가 부담합니다.';
    $('.insurance-pill').lastChild.textContent=(Number(ym.slice(0,4))===2026?' 2026년 보험료 자동 계산':' 2026년 요율로 참고 계산');
    $('#taxBadge').textContent=!result.taxKnown?'소득세 미확정':'2026 세액 반영';
    $('#taxBadge').classList.toggle('unknown',!result.taxKnown);
    $('#estimateNotice').textContent=result.taxKnown?'지금까지 입력한 기록으로 계산한 금액입니다.':'지원 세액표 범위 밖으로 소득세가 미확정된 잠정 금액입니다.';
    $('#incomeTotal2').textContent=won(result.gross);$('#deductionTotal2').textContent=won(result.deductions);$('#netTotal2').textContent=won(result.net);
    const earnLines=[['기본급',result.earnings.base,`${fmt(result.h.base+result.h.paid)}h × 시급`],['주차(주휴)수당',result.earnings.weekly,`${fmt(result.weeklyHours)}h`],['연장근로수당',result.earnings.overtime,`${fmt(result.h.overtime)}h × ${result.s.overtimeRate}`],['휴일근로수당',result.earnings.holiday,`${fmt(result.h.holiday)}h × ${result.s.holidayRate}`],['휴일연장수당',result.earnings.holidayExtra,`${fmt(result.h.holidayExtra)}h × ${result.s.holidayExtraRate}`],['야간근로수당',result.earnings.night,`${fmt(result.h.night)}h × ${result.s.nightRate}`],['수당',result.earnings.allowance,'고정 + 추가수당'],['교통비',result.earnings.transport,'']];
    const dedLines=[['근로소득세',result.components.incomeTax,'2026 간이세액표 · 본인 1명 기준'],['지방소득세',result.components.localTax,'근로소득세 × 10%'],['국민연금',result.components.pension,'근로자 부담분'],['건강보험',result.components.health,'근로자 부담분'],['장기요양보험',result.components.care,'건강보험료 기준'],['고용보험',result.components.employment,'근로자 부담분'],['기타 공제',result.components.additionalDeduction,'']];
    fillLines($('#earningLines'),earnLines);
    fillLines($('#deductLines'),dedLines);
    const warn=$('#taxWarning');warn.hidden=result.taxKnown;
    if(!result.taxKnown)warn.textContent='현재 월 과세급여는 앱에 수록된 2026년 간이세액표 범위를 벗어났습니다. 소득세·지방소득세는 미확정이며, 표시된 실수령액은 해당 세금을 제외한 잠정 금액입니다.';
    const summary=[['기본근무',result.h.base+'h'],['잔업 / 연장',result.h.overtime+'h'],['휴일특근',(result.h.holiday+result.h.holidayExtra)+'h'],['유급일',result.h.paid+'h'],['주휴 인정',result.weeklyDays+'회'],['야간 추가',result.h.night+'h']];
    $('#hourSummary').replaceChildren(...summary.map(([label,val])=>{const d=document.createElement('div');d.className='houritem';const t=document.createElement('span');t.textContent=label;const b=document.createElement('strong');b.textContent=val;d.append(t,b);return d;}));
  }
  function animateNet(next){const target=$('#netTotal'),motion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;cancelAnimationFrame(countFrame);const start=lastRenderedNet===null?next:lastRenderedNet;lastRenderedNet=next;if(start===next||motion){target.innerHTML=`${fmt(next)}<small>원</small>`;return;}const began=performance.now(),duration=430;const loop=(t)=>{const p=Math.min((t-began)/duration,1),ease=1-Math.pow(1-p,3),value=Math.round(start+(next-start)*ease);target.innerHTML=`${fmt(value)}<small>원</small>`;if(p<1)countFrame=requestAnimationFrame(loop);};countFrame=requestAnimationFrame(loop);}
  function commitSettingInputs(){const current=settings();for(const el of $$('.setting-field')){if(el.disabled)continue;const value=Number(el.value);if(!Number.isFinite(value)||el.value.trim()===''){toast('설정의 숫자를 확인해 주세요.');return false;}current[el.name]=value;}current.weeklyMode=$('#weeklyMode').value;Object.assign(current,AUTOMATIC_ONLY);state.monthSettings[ym]=current;renderCalendar();renderSummary();return true;}
  function fillLines(node,lines){node.replaceChildren(...lines.map(([label,amount,explain])=>{
    const d=document.createElement('div');d.className='statement-line';const left=document.createElement('div');const t=document.createElement('span');t.textContent=label;left.appendChild(t);if(explain){const sm=document.createElement('small');sm.textContent=explain;left.appendChild(sm);}
    const a=document.createElement('strong');a.textContent=amount===null?'미확정':won(amount);d.append(left,a);return d;}));}
  function renderAll(){renderCalendar();mountSettings();renderSummary();showTab(activeTab);}
  function showTab(tab){activeTab=tab;$$('.tabs button').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));for(const key of ['calendar','statement','settings'])$('#'+key+'Panel').hidden=key!==tab;window.scrollTo({top:0,behavior:'instant'});}
  $$('.tabs button').forEach(el=>el.addEventListener('click',()=>showTab(el.dataset.tab)));
  $('#settingsShortcut').addEventListener('click',()=>showTab('settings'));
  $('#globalSave').addEventListener('click',saveAll);
  $('#prevMonth').addEventListener('click',()=>changeMonth(-1));$('#nextMonth').addEventListener('click',()=>changeMonth(1));
  $('#todayBtn').addEventListener('click',()=>{ym=`${now.getFullYear()}-${pad(now.getMonth()+1)}`;renderAll();});
  $('#monthPickerBtn').addEventListener('click',()=>{const input=$('#monthPicker');if(input.showPicker)input.showPicker();else input.click();});
  $('#monthPicker').addEventListener('change',e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){ym=e.target.value;renderAll();}});
  $('#sheetBackdrop').addEventListener('click',closeSheet);$('#closeSheet').addEventListener('click',closeSheet);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selectedDate)closeSheet();});
  $$('#quickPresets button').forEach(el=>el.addEventListener('click',()=>{temporaryRecord=dayPreset(el.dataset.preset);refreshSheet();}));
  $('#recordType').addEventListener('change',e=>{const map={work:'work8',holiday:'holiday8',paid:'paid8',off:'off',absent:'absent',custom:'custom'};temporaryRecord=dayPreset(map[e.target.value]);refreshSheet();});
  $('#dayFields').addEventListener('input',e=>{if(!e.target.matches('.day-field'))return;temporaryRecord[e.target.name]=Math.max(0,Number(e.target.value)||0);});
  $('#recordNote').addEventListener('input',e=>{temporaryRecord.note=e.target.value;});
  $('#saveDay').addEventListener('click',()=>{
    if(!selectedDate)return;
    if(!['work','holiday','paid','off','absent','custom'].includes(temporaryRecord.type))return toast('근무 분류를 확인해 주세요.');
    for(const k of ['base','overtime','holiday','holidayExtra','night','paid']){const x=Number(temporaryRecord[k]);if(!Number.isFinite(x)||x<0||x>24)return toast('시간은 0~24시간으로 입력해 주세요.');}
    if(['off','absent'].includes(temporaryRecord.type))temporaryRecord=dayPreset(temporaryRecord.type);
    state.records[selectedDate]={...temporaryRecord};if(save()){flashSaved();closeSheet();renderCalendar();renderSummary();toast('근무 기록을 저장했어요.');}});
  $('#deleteDay').addEventListener('click',()=>{if(!selectedDate)return;delete state.records[selectedDate];save();closeSheet();renderCalendar();renderSummary();toast('해당 날짜 기록을 삭제했어요.');});
  for(const id of ['payFields','rateFields','weeklyFields','adjustFields']){
    $('#'+id).addEventListener('change',e=>{
      if(!e.target.classList.contains('setting-field'))return;
      const value=Number(e.target.value);if(!Number.isFinite(value))return;
      setSetting(e.target.name,value);
      if(id==='adjustFields')renderSummary();
    });
  }
  $('#weeklyMode').addEventListener('change',e=>setSetting('weeklyMode',e.target.value));
  $('#saveDefaults').addEventListener('click',()=>{if(!commitSettingInputs())return;state.defaults={...settings()};if(save()){flashSaved();toast('현재 설정을 향후 월의 기본값으로 저장했어요.');}});
  $('#resetMonth').addEventListener('click',()=>{if(!confirm(`${ym} 급여 설정을 기본값으로 되돌릴까요? 날짜별 근무 기록은 유지됩니다.`))return;delete state.monthSettings[ym];save();renderAll();toast('이달 급여 설정이 초기화됐어요.');});
  $('#exportBtn').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`급여기록_백업_${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('백업 파일을 저장했어요.');});
  $('#importBtn').addEventListener('click',()=>$('#importFile').click());
  $('#importFile').addEventListener('change',async e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    try{const val=JSON.parse(await file.text());
      if(val.version!==1||typeof val.records!=='object'||!val.records||Array.isArray(val.records)||typeof val.defaults!=='object')throw Error('잘못된 백업 형식');
      if(!confirm('현재 기록과 설정을 백업 파일로 교체할까요?'))return;
      state={version:1,records:val.records,defaults:{...C.DEFAULT,...val.defaults},monthSettings:val.monthSettings||{}};
      save();renderAll();toast('백업을 복원했어요.');
    }catch(err){alert('복원 실패: '+err.message);}finally{e.target.value='';}
  });
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  renderAll();
})();
