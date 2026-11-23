(function () {
  'use strict';
  const C=window.PayCalc, $=(s)=>document.querySelector(s), $$=(s)=>Array.from(document.querySelectorAll(s));
  const storageKey='personal-payroll-pwa-v1';
  const now=new Date();let ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let state={version:1,records:{},defaults:{...C.DEFAULT},monthSettings:{}};
  try {const data=JSON.parse(localStorage.getItem(storageKey)||'null');if(data&&data.version===1){state={version:1,records:data.records||{},defaults:{...C.DEFAULT,...(data.defaults||{})},monthSettings:data.monthSettings||{}};}}catch(e){console.warn('저장된 기록을 읽지 못했습니다.',e);}
  let activeTab='calendar',selectedDate=null,temporaryRecord=null,toastTimer;
  const fmt=v=>Math.round(Number(v)||0).toLocaleString('ko-KR');
  const won=v=>`${fmt(v)}원`;
  const pad=n=>String(n).padStart(2,'0');
  const dateKey=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
  const labelDate=(date)=>{const [y,m,d]=date.split('-').map(Number);return `${y}년 ${m}월 ${d}일 (${['일','월','화','수','목','금','토'][new Date(y,m-1,d).getDay()]})`;};
  function save(){try{localStorage.setItem(storageKey,JSON.stringify(state));}catch(e){toast('기기 저장 공간이 부족합니다. 백업 파일을 저장하세요.');}}
  function toast(msg){const node=$('#toast');node.textContent=msg;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),2800);}
  function settings(){return {...C.DEFAULT,...state.defaults,...(state.monthSettings[ym]||{})};}
  function setSetting(key,value){const merged=settings();merged[key]=value;state.monthSettings[ym]=merged;save();renderSummary();renderSettingsHints();}
  function changeMonth(step){let[y,m]=ym.split('-').map(Number);let d=new Date(y,m-1+step,1);ym=`${d.getFullYear()}-${pad(d.getMonth()+1)}`;renderAll();}
  const defNum=(name,label,step=1,hint='',min=0)=>({name,label,step,hint,min});
  const fieldGroups={
    pay:[defNum('hourly','시급 (원)',10),defNum('allowance','고정수당 (원)',1000),defNum('transport','교통비 (원)',1000),defNum('extraAllowance','기타 추가수당 (원)',1000)],
    rates:[defNum('overtimeRate','잔업 배율 (1.5 = 150%)',.1),defNum('holidayRate','특근 8시간 이내 배율',.1),defNum('holidayExtraRate','특근 8시간 초과 배율',.1),defNum('nightRate','야간 추가 가산 배율',.1)],
    weekly:[defNum('weeklyDays','주휴 인정 횟수 (회)',.5),defNum('weeklyPaidHours','주휴 1회당 시간',.5)],
    insurance:[defNum('pensionRate','국민연금 본인 부담률',.00005),defNum('healthRate','건강보험 본인 부담률',.00005),defNum('careRate','장기요양 / 건강보험료',.0001),defNum('employmentRate','고용보험 본인 부담률',.0001),defNum('excludedInsurance','보험 산정 제외 금액 (원)',1000),defNum('excludedTax','소득세 비과세 금액 (원)',1000),defNum('extraDeduction','기타 공제액 (원)',1000)],
    tax:[defNum('manualTax','근로소득세 직접 입력 (원)',10),defNum('taxPercent','원천징수 적용 비율 (%)',10)],
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
    for(const [name,target] of [['pay','#payFields'],['rates','#rateFields'],['weekly','#weeklyFields'],['insurance','#insuranceFields'],['tax','#taxFields'],['adjustments','#adjustFields']]){
      const node=$(target);node.replaceChildren(...fieldGroups[name].map(d=>formField(d,s[d.name])));
    }
    $('#weeklyMode').value=s.weeklyMode;$('#taxMode').value=s.taxMode;
    renderSettingsHints();
  }
  function renderSettingsHints(){
    const s=settings();$('#settingMonthText').textContent=`${ym.replace('-','년 ')}월에만 적용 · 저장 즉시 계산`;
    const wi=$('#weeklyFields').querySelector('[name="weeklyDays"]');wi.disabled=s.weeklyMode==='auto';wi.closest('.field').classList.toggle('disabled',s.weeklyMode==='auto');
    const ti=$('#taxFields').querySelector('[name="manualTax"]');ti.disabled=s.taxMode!=='manual';ti.closest('.field').classList.toggle('disabled',s.taxMode!=='manual');
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
  function dayCaption(r){if(!r)return null;
    const over=Number(r.overtime)||0,holiday=(Number(r.holiday)||0)+(Number(r.holidayExtra)||0),base=Number(r.base)||0;
    if(r.type==='off')return['휴무','off'];if(r.type==='absent')return['결근','absence'];
    if(holiday>0)return[`특근 ${holiday}h`,'special'];
    if(Number(r.paid)>0 && !base)return[`유급 ${r.paid}h`,'leave'];
    if(base+over>0)return[`${base+over}h`+(over>0?' 잔업':''),over>0?'overtime':'work'];
    return['입력','work'];}
  function renderCalendar(){
    const[y,m]=ym.split('-').map(Number),start=new Date(y,m-1,1).getDay(),last=new Date(y,m,0).getDate();
    const node=$('#calendarGrid');node.replaceChildren();
    for(let i=0;i<start;i++){const p=document.createElement('div');p.className='calendar-blank';node.appendChild(p);}
    for(let d=1;d<=last;d++){
      const key=dateKey(y,m,d),r=state.records[key],caption=dayCaption(r);
      const cell=document.createElement('button');cell.type='button';cell.className='calendar-cell';cell.dataset.date=key;
      if(new Date(y,m-1,d).getDay()===0)cell.classList.add('sunday');
      if(new Date(y,m-1,d).getDay()===6)cell.classList.add('saturday');
      if(y===now.getFullYear()&&m===now.getMonth()+1&&d===now.getDate())cell.classList.add('today');
      const numeral=document.createElement('span');numeral.className='daynum';numeral.textContent=d;cell.appendChild(numeral);
      if(caption){const chip=document.createElement('small');chip.className='day-chip '+caption[1];chip.textContent=caption[0];cell.appendChild(chip);}
      else{const plus=document.createElement('span');plus.className='day-add';plus.textContent='+';cell.appendChild(plus);}
      cell.setAttribute('aria-label',`${labelDate(key)} ${caption?caption[0]:'기록 없음'}`);
      cell.addEventListener('click',()=>openSheet(key));node.appendChild(cell);
    }
    const extra=(7-(start+last)%7)%7;
    for(let i=0;i<extra;i++){const p=document.createElement('div');p.className='calendar-blank';node.appendChild(p);}
  }
  function openSheet(date){selectedDate=date;temporaryRecord={...(state.records[date]||dayPreset('work8'))};$('#sheetTitle').textContent=labelDate(date);refreshSheet();$('#daySheet').hidden=false;$('#sheetBackdrop').hidden=false;document.body.classList.add('sheet-open');}
  function refreshSheet(){
    $('#recordType').value=temporaryRecord.type||'custom';
    $('#recordNote').value=temporaryRecord.note||'';
    $('#dayFields').replaceChildren(...dayDefs.map(def=>formField(def,temporaryRecord[def.name],'day-field')));
    const selected=temporaryRecord;
    $$('#quickPresets button').forEach(btn=>{
      const p=dayPreset(btn.dataset.preset);btn.classList.toggle('selected',Object.keys(p).every(k=>k==='note'||selected[k]===p[k]));
    });
  }
  function closeSheet(){selectedDate=null;temporaryRecord=null;$('#daySheet').hidden=true;$('#sheetBackdrop').hidden=true;document.body.classList.remove('sheet-open');}
  function renderSummary(){
    const result=C.payroll(state.records,ym,settings());
    $('#monthTitle').textContent=ym.replace(/^([0-9]{4})-([0-9]{2})$/,(a,y,m)=>`${y}년 ${Number(m)}월`);
    $('#monthPicker').value=ym;
    $('#netTotal').innerHTML=`${fmt(result.net)}<small>원</small>`;
    $('#grossTotal').textContent=won(result.gross);$('#deductTotal').textContent=won(result.deductions);
    $('#workedDays').textContent=`${result.h.days+result.h.holidayDays}일`;
    $('#taxBadge').textContent=!result.taxKnown?'소득세 미확정':result.s.taxMode==='manual'?'수동 세액 반영':'2026 세액 반영';
    $('#taxBadge').classList.toggle('unknown',!result.taxKnown);
    $('#estimateNotice').textContent=result.taxKnown?'지금까지 입력한 기록으로 계산한 금액입니다.':'소득세가 빠지지 않은 잠정 금액입니다. 설정에서 소득세를 직접 입력하세요.';
    $('#incomeTotal2').textContent=won(result.gross);$('#deductionTotal2').textContent=won(result.deductions);$('#netTotal2').textContent=won(result.net);
    const earnLines=[['기본급',result.earnings.base,`${fmt(result.h.base+result.h.paid)}h × 시급`],['주차(주휴)수당',result.earnings.weekly,`${fmt(result.weeklyHours)}h`],['연장근로수당',result.earnings.overtime,`${fmt(result.h.overtime)}h × ${result.s.overtimeRate}`],['휴일근로수당',result.earnings.holiday,`${fmt(result.h.holiday)}h × ${result.s.holidayRate}`],['휴일연장수당',result.earnings.holidayExtra,`${fmt(result.h.holidayExtra)}h × ${result.s.holidayExtraRate}`],['야간근로수당',result.earnings.night,`${fmt(result.h.night)}h × ${result.s.nightRate}`],['수당',result.earnings.allowance,'고정 + 추가수당'],['교통비',result.earnings.transport,'']];
    const dedLines=[['근로소득세',result.components.incomeTax,'2026 간이세액표 / 수동'],['지방소득세',result.components.localTax,'근로소득세 × 10%'],['국민연금',result.components.pension,'근로자 부담분'],['건강보험',result.components.health,'근로자 부담분'],['장기요양보험',result.components.care,'건강보험료 기준'],['고용보험',result.components.employment,'근로자 부담분'],['기타 공제',result.components.additionalDeduction,'']];
    fillLines($('#earningLines'),earnLines);
    fillLines($('#deductLines'),dedLines);
    const warn=$('#taxWarning');warn.hidden=result.taxKnown;
    if(!result.taxKnown)warn.textContent='현재 월 과세급여는 자동 수록 세액표 범위를 벗어났습니다. 급여 설정 → 근로소득세 계산 → 직접 입력으로 세액을 지정하세요. 표시된 실수령액은 소득세·지방소득세 공제 전 잠정액입니다.';
    const summary=[['기본근무',result.h.base+'h'],['잔업 / 연장',result.h.overtime+'h'],['휴일특근',(result.h.holiday+result.h.holidayExtra)+'h'],['유급일',result.h.paid+'h'],['주휴 인정',result.weeklyDays+'회'],['야간 추가',result.h.night+'h']];
    $('#hourSummary').replaceChildren(...summary.map(([label,val])=>{const d=document.createElement('div');d.className='houritem';const t=document.createElement('span');t.textContent=label;const b=document.createElement('strong');b.textContent=val;d.append(t,b);return d;}));
  }
  function fillLines(node,lines){node.replaceChildren(...lines.map(([label,amount,explain])=>{
    const d=document.createElement('div');d.className='statement-line';const left=document.createElement('div');const t=document.createElement('span');t.textContent=label;left.appendChild(t);if(explain){const sm=document.createElement('small');sm.textContent=explain;left.appendChild(sm);}
    const a=document.createElement('strong');a.textContent=amount===null?'미확정':won(amount);d.append(left,a);return d;}));}
  function renderAll(){renderCalendar();mountSettings();renderSummary();showTab(activeTab);}
  function showTab(tab){activeTab=tab;$$('.tabs button').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));for(const key of ['calendar','statement','settings'])$('#'+key+'Panel').hidden=key!==tab;window.scrollTo({top:0,behavior:'instant'});}
  $$('.tabs button').forEach(el=>el.addEventListener('click',()=>showTab(el.dataset.tab)));
  $('#settingsShortcut').addEventListener('click',()=>showTab('settings'));
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
    state.records[selectedDate]={...temporaryRecord};save();closeSheet();renderCalendar();renderSummary();toast('근무 기록을 저장했어요.');});
  $('#deleteDay').addEventListener('click',()=>{if(!selectedDate)return;delete state.records[selectedDate];save();closeSheet();renderCalendar();renderSummary();toast('해당 날짜 기록을 삭제했어요.');});
  for(const id of ['payFields','rateFields','weeklyFields','insuranceFields','taxFields','adjustFields']){
    $('#'+id).addEventListener('change',e=>{
      if(!e.target.classList.contains('setting-field'))return;
      const value=Number(e.target.value);if(!Number.isFinite(value))return;
      setSetting(e.target.name,value);
      if(id==='adjustFields')renderSummary();
    });
  }
  $('#weeklyMode').addEventListener('change',e=>setSetting('weeklyMode',e.target.value));
  $('#taxMode').addEventListener('change',e=>setSetting('taxMode',e.target.value));
  $('#saveDefaults').addEventListener('click',()=>{state.defaults={...settings()};save();toast('현재 설정을 향후 월의 기본값으로 저장했어요.');});
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
