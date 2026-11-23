/* 개인 급여 계산 엔진. 2026년 10월·8월 실제 명세서 금액과 검산됨. */
(function (global) {
  'use strict';
  const DEFAULT = Object.freeze({
    hourly:10320, allowance:300000, transport:100000, extraAllowance:0,
    dailyHours:8, weeklyPaidHours:8, overtimeRate:1.5, holidayRate:1.5,
    holidayExtraRate:2, nightRate:.5, pensionRate:.0475,
    healthRate:.03595, careRate:.1314, employmentRate:.009,
    excludedInsurance:0, pensionBasis:0, healthBasis:0, excludedTax:0, taxMode:'table', manualTax:0,
    taxPercent:100, weeklyMode:'manual', weeklyDays:0,
    baseAdjust:0, overtimeAdjust:0, holidayAdjust:0,
    holidayExtraAdjust:0, nightAdjust:0, paidAdjust:0,
    extraDeduction:0
  });
  const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const floor10 = v => Math.floor(Math.max(0, v) / 10 + 1e-9) * 10;
  const floor1000 = v => Math.floor(Math.max(0, v) / 1000) * 1000;
  const roundWon = v => Math.round(v);

  // 2026-02-27 개정 근로소득 간이세액표: 공제대상 가족 1명 구간의 원본 값.
  // 출처: 소득세법 시행령 별표2 (2026.03.01 이후 적용). 보유하지 않은 구간은 추정하지 않음.
  const T=[];
  function addRows(start,step,values) { values.forEach((v,i)=>T.push([Math.round((start+i*step)*1000), Math.round((start+(i+1)*step)*1000),v])); }
  addRows(2290,10,[28840,29160,29480,29810,30130,30450,30770,31090,31410,31730,32050,32380,32700,33020,33340,33660,33980,34300,34630,34950,35270,35600,35940,36280,36630,36970,37310,37650,38000,38340,38830,39690,40540,41400,42260,43110,43970,44820,45680,46540,47390,48250,49100,49960,50810,51670,52530,53380,54240,55090,55950,56800,57660,58520,59370,60230,61080,61940,62790,63650,64510,65360,66220,67070,67930,68780,69640,70500,71350,72210,73060]);
  // 시작 금액이 2,290천원부터 10천원 단위로 이어지며 3,000천원 전까지 71구간.
  addRows(3000,20,[74350,76060,77770,79480,81190,82900,84620,86330,88040,89750,91460,93170,95430,97880,100320,102770,105210,107660,110100,112550,114990,117440,119880,122330,124770,127220,129660,132110,134550,137000,139440,141890,144330,146780,149220,151670,154110,156560,163920,166590,169260,171930,174600,177270,179940,182610,185280,187950,190620,193290,195960,198630,201300,203970,206640,209310,211980,214650,217320,219990,222660,225330,228000,230670,233340,236010,238680,241350,244020,246690,249360,252030,254700,257370,260040,262840,265650,268450,271260,276560,279370,282170,284980,287780,290590]);
  function tableTax(monthlyTaxable) {
    if (monthlyTaxable < 1060000) return 0;
    const found=T.find(([lo,hi])=>monthlyTaxable>=lo && monthlyTaxable<hi);
    return found ? found[2] : null;
  }
  function extractTotals(records,ym) {
    const sums={base:0,overtime:0,holiday:0,holidayExtra:0,night:0,paid:0,days:0,paidDays:0,holidayDays:0};
    Object.entries(records||{}).forEach(([date,r])=>{
      if(!date.startsWith(ym+'-')||!r||r.type==='off'||r.type==='absent')return;
      for(const k of ['base','overtime','holiday','holidayExtra','night','paid'])sums[k]+=Math.max(0,n(r[k]));
      if(n(r.base)+n(r.overtime)>0)sums.days++;
      if(n(r.paid)>0)sums.paidDays++;
      if(n(r.holiday)+n(r.holidayExtra)>0)sums.holidayDays++;
    });
    return sums;
  }
  function autoWeeklyDays(records,ym){
    // 참고 추정: 월~금 기록이 모두 존재하고 결근이 없으며 소정근로가 주 15시간 이상일 때.
    // 교대제, 월 경계, 휴일 및 실제 개근 규칙은 회사마다 다르므로 수동 설정 우선.
    const [year,month]=ym.split('-').map(Number);
    const last=new Date(year,month,0).getDate();
    let count=0;
    for(let day=1;day<=last;day++){
      const d=new Date(year,month-1,day);if(d.getDay()!==0)continue;
      const mon=new Date(year,month-1,day-6);
      let complete=true,scheduled=0;
      for(let i=0;i<5;i++){
        const dd=new Date(mon);dd.setDate(mon.getDate()+i);
        const key=`${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')}`;
        const r=records[key];
        if(!r||r.type==='absent'){complete=false;break;}
        scheduled+=Math.max(0,n(r.base)+n(r.paid));
      }
      if(complete&&scheduled>=15)count++;
    }
    return count;
  }
  function payroll(records,ym,input){
    const s={...DEFAULT,...(input||{})};
    const h=extractTotals(records,ym);
    for(const [src,target] of [['baseAdjust','base'],['overtimeAdjust','overtime'],['holidayAdjust','holiday'],['holidayExtraAdjust','holidayExtra'],['nightAdjust','night'],['paidAdjust','paid']]) {
      h[target]=Math.max(0,h[target]+n(s[src]));
    }
    const weeklyDays=s.weeklyMode==='auto'?autoWeeklyDays(records,ym):Math.max(0,n(s.weeklyDays));
    const weeklyHours=weeklyDays*Math.max(0,n(s.weeklyPaidHours));
    const rate=Math.max(0,n(s.hourly));
    const earnings={
      base:roundWon((h.base+h.paid)*rate),
      weekly:roundWon(weeklyHours*rate),
      overtime:roundWon(h.overtime*rate*n(s.overtimeRate)),
      holiday:roundWon(h.holiday*rate*n(s.holidayRate)),
      holidayExtra:roundWon(h.holidayExtra*rate*n(s.holidayExtraRate)),
      night:roundWon(h.night*rate*n(s.nightRate)),
      allowance:roundWon(n(s.allowance)+n(s.extraAllowance)),
      transport:roundWon(n(s.transport))
    };
    const gross=Object.values(earnings).reduce((a,b)=>a+b,0);
    const socialBase=Math.max(0,gross-n(s.excludedInsurance));
    const pensionBase=n(s.pensionBasis)>0?n(s.pensionBasis):socialBase;
    const healthBase=n(s.healthBasis)>0?n(s.healthBasis):socialBase;
    const pension=floor10(floor1000(pensionBase)*n(s.pensionRate));
    const health=floor10(healthBase*n(s.healthRate));
    const care=floor10(health*n(s.careRate));
    const employment=floor10(socialBase*n(s.employmentRate));
    const taxable=Math.max(0,gross-n(s.excludedTax));
    const rawTax=s.taxMode==='manual' ? Math.max(0,n(s.manualTax)) : tableTax(taxable);
    const taxKnown=rawTax!==null;
    const incomeTax=taxKnown?floor10(rawTax*n(s.taxPercent)/100):null;
    const localTax=taxKnown?floor10(incomeTax*.1):null;
    const insurance=pension+health+care+employment;
    const additionalDeduction=Math.max(0,n(s.extraDeduction));
    const deductions=insurance+(incomeTax||0)+(localTax||0)+additionalDeduction;
    return {s,h,weeklyDays,weeklyHours,earnings,gross,taxable,taxKnown,insurance,deductions,
      net:gross-deductions,
      insuranceBases:{pension:pensionBase,health:healthBase,employment:socialBase},
      components:{pension,health,care,employment,incomeTax,localTax,additionalDeduction}};
  }
  global.PayCalc={DEFAULT,tableTax,extractTotals,autoWeeklyDays,payroll};
})(typeof window!=='undefined'?window:globalThis);
