/* Rasumi Apps invite page: per-app automation maps (problem -> mapped workflow, animated)
   Built once the invitation view is visible (SVG lengths need a rendered layout). */
(function wait(){var v=document.getElementById('v-open');if(!v||v.hidden){return setTimeout(wait,200)}
'use strict';
/* node: [x, y, label, sub, kind]   kind: in | step | q (decision) | out | hold
   edge: [from, to, label?, 'no']    route: {p:[ids], c:caption, a:alt(branch)} */
var APPS=[
{id:'hq',n:'01',name:'PDF Renamer · HQ',ic:'renamer',h:300,
 prob:'Every scanned invoice and DO was opened, read and <b>renamed by hand, one file at a time</b>: type the document number, type the ID, save, next. Only then could it be uploaded to DocuShare. One typo and the file was lost in the folder.',
 lead:'Drop the batch. <em>Rasumi Apps reads both numbers and names every file.</em>',
 N:{a:[70,150,'Batch of PDFs','Scanned INV / DO','in'],b:[245,150,'Read page 1 & 2','Digital text or OCR','step'],c:[420,150,'Doc No + ID','S-series prefix fixed','step'],d:[595,150,'Confident?','Pages agree · ≥ 75%','q'],
    e:[770,90,'Rename','DocNo ID.pdf','step'],f:[945,90,'Renamed Success','Ready for DocuShare','out'],g:[770,215,'Hold for review','Not renamed, flagged','hold'],h:[945,215,'Name taken?','Suffix _2 added','step']},
 E:[['a','b'],['b','c'],['c','d'],['d','e','yes'],['e','f'],['d','g','no','no'],['e','h','','no']],
 R:[{p:['a','b','c','d','e','f'],c:'Number and ID read, both pages agree, file renamed'},{p:['a','b','c','d','g'],c:'Low confidence: the file is held back instead of a wrong name',a:1},{p:['a','b','c','d','e','h'],c:'Same name already exists: a suffix keeps both files safe',a:1}]},
{id:'fv',n:'02',name:'PDF Renamer · FV',ic:'renamer',h:300,
 prob:'Farmasi Veteran DOs were renamed by <b>typing each DO number from the paper</b>. Faded prints and look-alike digits (1 / 7, 0 / 8) gave wrong names that surfaced weeks later.',
 lead:'<em>Every DO number is read, re-checked and corrected before the file is renamed.</em>',
 N:{a:[70,150,'FV DO scans','Any number of files','in'],b:[245,150,'Read DO number','OCR at 300 dpi','step'],c:[420,150,'Suspicious digit?','7 · 1 · 0 · 8','q'],d:[595,80,'Re-read','Sharper / eroded image','step'],
    e:[595,220,'Accepted','Reading confirmed','step'],f:[770,150,'Prefix check','Learned from the batch','step'],g:[945,150,'Rename','NoDO.pdf','out']},
 E:[['a','b'],['b','c'],['c','d','yes'],['c','e','no'],['d','f'],['e','f'],['f','g']],
 R:[{p:['a','b','c','e','f','g'],c:'Clear number: accepted, prefix checked, renamed'},{p:['a','b','c','d','f','g'],c:'Doubtful digit: read again with a sharper image before renaming',a:1}]},
{id:'sp',n:'03',name:'PDF Splitter',ic:'splitter',h:340,
 prob:'A claim arrives as <b>one long scan</b>: invoice, DO, prescription, IC, BQBP, service book. Staff split it <b>page by page in a PDF tool</b> and named every part themselves.',
 lead:'<em>Each page is recognised, grouped and saved as its own document.</em>',
 N:{a:[70,170,'Claim PDF','One scan, many pages','in'],b:[240,170,'Classify page','Text + layout','step'],
    t1:[430,50,'INV · DO · PS','One page each','step'],t2:[430,130,'IC','Patient / veteran card','step'],t3:[430,210,'BQBP · Service book','Multi-page','step'],t4:[430,290,'Letters · OKU · others','Pengesahan, kelulusan…','step'],
    c:[620,210,'Keep together','Same document, same file','step'],d:[620,130,'IC complete?','Front and back present','q'],e:[800,170,'Save','Folder per claim','step'],f:[960,170,'Split Success','11011317_4_BQBP.pdf','out']},
 E:[['a','b'],['b','t1'],['b','t2'],['b','t3'],['b','t4'],['t1','e'],['t2','d'],['d','e','yes'],['t3','c'],['t4','c'],['c','e'],['e','f']],
 R:[{p:['a','b','t1','e','f'],c:'Invoice, DO and prescription pages saved as their own PDFs'},{p:['a','b','t3','c','e','f'],c:'BQBP and service-book pages kept together in one file'},{p:['a','b','t2','d','e','f'],c:'IC pages checked for front and back before saving'}]},
{id:'sc',n:'04',name:'Scanify',ic:'scanify',h:300,
 prob:'Forms and IC cards were <b>photographed on a phone</b>, then cropped, rotated and converted with separate apps. IC front and back were <b>pasted into a Word page</b> by hand.',
 lead:'<em>Photos in, a clean PDF out, IC front and back on one page.</em>',
 N:{a:[70,150,'Photos','JPG · PNG · HEIC','in'],b:[230,150,'Form or ID?','Choose once','q'],
    c:[400,80,'Find corners','Auto edge detection','step'],d:[570,80,'Adjust','Drag · rotate · auto align','step'],e:[740,80,'PDF preview','Reorder · remove pages','step'],
    f:[400,220,'Crop front','Then the back','step'],g:[570,220,'Assemble','Front top, back below','step'],h:[740,220,'Check','Swap if needed','step'],
    i:[930,150,'Save PDF','To Downloads','out']},
 E:[['a','b'],['b','c','form'],['c','d'],['d','e'],['e','i'],['b','f','ID'],['f','g'],['g','h'],['h','i']],
 R:[{p:['a','b','c','d','e','i'],c:'Form: corners found, cleaned, pages checked, saved as one PDF'},{p:['a','b','f','g','h','i'],c:'ID card: front and back cropped and placed on one A4 page',a:1}]},
{id:'vb',n:'05',name:'Vibes Agent',ic:'settings',h:300,
 prob:'Each claim’s documents were <b>uploaded into VIMS one by one</b>: find the claim, choose the document type, upload, repeat, for every claim, every day.',
 lead:'<em>Vibes Agent works VIMS for you and proves every file arrived.</em>',
 N:{a:[70,150,'Start','One click','in'],b:[230,150,'Open VIMS','Signed-in session','step'],c:[400,150,'Read claim list','Every page of the SAH list','step'],d:[570,150,'Match documents','IC · INV · DO · BQBP…','step'],
    e:[740,150,'Upload','Right slot per type','step'],f:[905,150,'All arrived?','Portal vs local files','q'],g:[905,260,'Retry & alert','Missing files listed','hold'],h:[905,45,'Completed','Claim reconciled','out']},
 E:[['a','b'],['b','c'],['c','d'],['d','e'],['e','f'],['f','h','yes'],['f','g','no','no'],['g','e','','no']],
 R:[{p:['a','b','c','d','e','f','h'],c:'Claims read, documents matched and uploaded, every file confirmed'},{p:['a','b','c','d','e','f','g','e','f','h'],c:'A file did not reach the portal: it is retried and reported',a:1}]},
{id:'po',n:'06',name:'PO Mailer',ic:'po_mailer',who:'Purchaser',h:360,
 prob:'Stock checked in <b>Excel</b>, POs keyed into <b>AutoCount</b>, then <b>printed, signed, stamped and scanned</b>, e-mailed by hand, deliveries chased by <b>phone and WhatsApp</b>, invoices hunted in the mailbox.',
 lead:'<em>From low stock to supplier invoice on one screen.</em>',
 N:{s1:[70,70,'Stock Alert','Smart min / max','in'],s2:[70,180,'Special Request','From a pharmacist','in'],s3:[70,290,'New PO','Any item, any supplier','in'],
    a:[250,180,'AutoCount PO','One PO per supplier','step'],b:[420,180,'Process PO','Read · match supplier & branch','step'],c:[590,180,'Sign needed?','Pharmaniaga · Special Request','q'],
    d:[590,70,'Sign & stamp','PIC signature + branch chop','step'],e:[760,180,'Send','E-mail or WhatsApp','step'],f:[930,180,'Delivery sync','DKSH · Zuellig · AutoCount','step'],
    g:[930,70,'Invoice','Downloaded, logged','out'],h:[930,290,'Req DO','Ask supplier for it','hold']},
 E:[['s1','a'],['s2','a'],['s3','a'],['a','b'],['b','c'],['c','d','yes'],['d','e'],['c','e','no'],['e','f'],['f','g','found'],['f','h','missing','no']],
 R:[{p:['s1','a','b','c','e','f','g'],c:'Stock Alert to AutoCount PO, sent, tracked, invoice ready'},{p:['s2','a','b','c','d','e','f','g'],c:'Special Request: the PO carries the pharmacist’s signature and stamp'},{p:['s3','a','b','c','e','f','h'],c:'Delivered but no invoice yet: Req DO asks the supplier',a:1}]},
{id:'sm',n:'07',name:'Store Management & Store Portal',ic:'store_portal',who:'Branches · Pharmacists',h:340,
 prob:'Bin cards lived on <b>paper and Excel</b>, transfers were agreed over <b>WhatsApp</b>, special requests were <b>messaged</b>, and no one could see stock across branches.',
 lead:'<em>Every movement lands on one live bin card, visible to every branch.</em>',
 N:{r:[90,60,'Receive','Against PO & invoice','in'],v:[90,150,'Dispense','Counter sales from VIMS','in'],t:[90,240,'Transfer','Branch to branch','in'],k:[90,320,'Stock count','Monthly / ad hoc','in'],
    b:[400,190,'Bin card','Live balance per branch','step'],o:[650,110,'Store Management','Out of stock · movers','out'],q:[650,270,'Below minimum?','Smart plan, nightly','q'],
    pa:[900,270,'PO Mailer','Stock Alert','out'],sr:[400,320,'Special Request','Pharmacist','in'],pu:[900,140,'Purchaser','Notified at once','out']},
 E:[['r','b'],['v','b'],['t','b'],['k','b'],['b','o'],['b','q'],['q','pa','yes'],['sr','pu']],
 R:[{p:['r','b','o'],c:'Deliveries received straight onto the bin card'},{p:['v','b','q','pa'],c:'Counter sales lower stock; below the minimum it appears in Stock Alert'},{p:['t','b','o'],c:'Transfers update both branches at once'},{p:['sr','pu'],c:'Special requests go straight to the purchaser',a:1}]}
];
var NS='http://www.w3.org/2000/svg',W=150,H=46;
var ICO={};
function mk(t,a,p){var e=document.createElementNS(NS,t);for(var k in a)e.setAttribute(k,a[k]);p&&p.appendChild(e);return e}
function tx(p,x,y,s,c){var e=mk('text',{x:x,y:y,'text-anchor':'middle','class':c||''},p);e.textContent=s;return e}
function dpath(A,B){var x1=A[0]+W/2,y1=A[1],x2=B[0]-W/2,y2=B[1];
 if(B[0]<A[0]){x1=A[0];y1=A[1]+(B[1]>A[1]?H/2:-H/2);x2=B[0];y2=B[1]+(B[1]>A[1]?-H/2:H/2);return 'M'+x1+' '+y1+' C'+x1+' '+(y1+(y2-y1)/2)+' '+x2+' '+(y1+(y2-y1)/2)+' '+x2+' '+y2}
 if(Math.abs(B[0]-A[0])<10){x1=A[0];x2=B[0];y1=A[1]+(B[1]>A[1]?H/2:-H/2);y2=B[1]+(B[1]>A[1]?-H/2:H/2);return 'M'+x1+' '+y1+' L'+x2+' '+y2}
 var mx=(x1+x2)/2;return 'M'+x1+' '+y1+' C'+mx+' '+y1+' '+mx+' '+y2+' '+x2+' '+y2}
var host=document.getElementById('chs'),idx=document.getElementById('idx');
idx.innerHTML=APPS.map(function(a){return '<a href="#'+a.id+'">'+a.name.replace(' & Store Portal','')+'</a>'}).join('');
APPS.forEach(function(a){
 var s=document.createElement('section');s.className='ch';s.id=a.id;
 s.innerHTML='<div class="hd"><img src="'+(ICO[a.ic]||('assets/icons/'+a.ic+'.webp'))+'" alt=""><div><div class="n">'+a.n+'</div><h3>'+a.name+(a.who?'<span class="for">'+a.who+'</span>':'')+'</h3></div></div>'+
  '<p class="prob"><span class="k">The problem</span>'+a.prob+'</p><p class="lead">'+a.lead+'</p><div class="map"></div><div class="cap"><i></i><span></span></div>';
 host.appendChild(s);
 var svg=mk('svg',{viewBox:'0 0 1030 '+a.h},s.querySelector('.map')),EG=mk('g',{},svg),NG=mk('g',{},svg),PG=mk('g',{},svg);
 a._e={};a._n={};
 a.E.forEach(function(e){var p=mk('path',{d:dpath(a.N[e[0]],a.N[e[1]]),'class':'e'+(e[3]?' no':'')},EG);a._e[e[0]+'>'+e[1]]=p;
  if(e[2]){var A=a.N[e[0]],B=a.N[e[1]],l=p.getTotalLength(),pt=p.getPointAtLength(l*.45);tx(EG,pt.x,pt.y-6,e[2],'el')}});
 Object.keys(a.N).forEach(function(k){var n=a.N[k],g=mk('g',{'class':'nd '+n[4]},NG);
  mk('rect',{'class':'b',x:n[0]-W/2,y:n[1]-H/2,width:W,height:H,rx:n[4]==='q'?8:23},g);tx(g,n[0],n[1]-2,n[2]);tx(g,n[0],n[1]+13,n[3],'s');a._n[k]=g});
 a._halo=mk('circle',{r:13,'class':'halo',filter:'url(#gl)',cx:-50,cy:-50},PG);a._pk=mk('circle',{r:5,'class':'pk',cx:-50,cy:-50},PG);
 a._cap=s.querySelector('.cap');a._sec=s;
});
var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function run(a){if(a._on)return;a._on=1;var ri=0;
 function route(){if(!a._vis){a._on=0;return}
  var r=a.R[ri%a.R.length];ri++;a._cap.classList.toggle('alt',!!r.a);a._cap.querySelector('span').textContent=r.c;
  a._halo.classList.toggle('a',!!r.a);
  Object.keys(a._e).forEach(function(k){a._e[k].classList.remove('lit')});Object.keys(a._n).forEach(function(k){a._n[k].classList.remove('hot')});
  var i=0;
  function hop(){if(!a._vis){a._on=0;return}
   var from=r.p[i],to=r.p[i+1];a._n[from].classList.add('hot');
   if(to===undefined){setTimeout(route,1500);return}
   var path=a._e[from+'>'+to];if(!path){i++;return hop()}
   path.classList.add('lit');var L=path.getTotalLength(),t0=null,dur=reduce?1:900;
   function fr(ts){if(!a._vis){a._on=0;return}if(t0===null)t0=ts;var k=Math.min(1,(ts-t0)/dur),pt=path.getPointAtLength(L*k);
    a._pk.setAttribute('cx',pt.x);a._pk.setAttribute('cy',pt.y);a._halo.setAttribute('cx',pt.x);a._halo.setAttribute('cy',pt.y);
    if(k<1)return requestAnimationFrame(fr);i++;setTimeout(hop,220)}
   requestAnimationFrame(fr)}
  hop()}
 route()}
var io=new IntersectionObserver(function(es){es.forEach(function(e){var a=APPS.filter(function(x){return x._sec===e.target})[0];a._vis=e.isIntersecting;if(e.isIntersecting){run(a);
 idx.querySelectorAll('a').forEach(function(l){l.classList.toggle('on',l.getAttribute('href')==='#'+a.id)})}})},{threshold:.35});
APPS.forEach(function(a){io.observe(a._sec)});
})();
