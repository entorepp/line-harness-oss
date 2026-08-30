function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1
  if (count !== 1) {
    throw new Error(`${label}: expected one source match, found ${count}`)
  }
  return source.replace(before, after)
}

function removeOnce(source, value, label) {
  return replaceOnce(source, value, '', label)
}

export function applyPostOrderSurveyReview(input) {
  let source = input

  source = replaceOnce(
    source,
    `input[type=file]{width:100%;font:inherit;font-size:13.5px;color:var(--ink-2);background:var(--ground);
  border:1px dashed var(--rule);border-radius:7px;padding:11px 12px}`,
    `.filepick{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:50px;
  border:1px dashed var(--rule);border-radius:8px;padding:9px 11px;background:var(--ground);cursor:pointer}
.filepick:hover{border-color:var(--accent);background:var(--accent-soft)}
.nativefile{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;
  overflow:hidden!important;pointer-events:none!important;padding:0!important;border:0!important}
.filebutton{flex:none;display:inline-flex;align-items:center;justify-content:center;min-height:34px;
  padding:7px 13px;border-radius:6px;background:var(--accent);color:#fff;font-size:13.5px;font-weight:700}
.filestatus{min-width:0;color:var(--ink-2);font-size:14px;line-height:1.5;overflow-wrap:anywhere}
.filepick:has(.nativefile:focus-visible){outline:2px solid var(--accent);outline-offset:2px;border-color:transparent}
@media(max-width:560px){.filepick{align-items:flex-start;flex-direction:column}.filebutton{width:100%}}`,
    'custom English file picker styles',
  )

  source = replaceOnce(
    source,
    `.upcat{background:var(--accent-soft);padding:8px 15px;font-size:13px;font-weight:700;color:var(--accent);`,
    `.upcat{background:var(--accent-soft);padding:10px 15px;font-size:14.5px;font-weight:700;color:var(--accent);`,
    'upsell category text size',
  )
  source = replaceOnce(
    source,
    `.upnote{font-size:11.5px;font-weight:400;color:var(--ink-3);letter-spacing:0}`,
    `.upnote{font-size:12.5px;font-weight:500;color:var(--ink-3);letter-spacing:0}`,
    'upsell helper text size',
  )
  source = replaceOnce(
    source,
    `.upgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:9px;padding:10px 15px 14px}`,
    `.upgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;padding:14px 15px 18px}`,
    'upsell card width',
  )
  source = replaceOnce(
    source,
    `.upthumb{display:flex;flex-direction:column;gap:6px;cursor:pointer;position:relative;
  border:1px solid var(--rule);border-radius:9px;padding:8px;background:var(--card)}`,
    `.upthumb{display:flex;flex-direction:column;gap:9px;cursor:pointer;position:relative;
  border:1px solid var(--rule);border-radius:10px;padding:10px;background:var(--card)}`,
    'upsell card spacing',
  )
  source = replaceOnce(
    source,
    `.upthumbname{font-size:12.5px;line-height:1.5}`,
    `.upthumbname{font-size:15px;line-height:1.55;font-weight:700}`,
    'upsell card name size',
  )

  source = replaceOnce(
    source,
    `e:"Upload your insurance certificate",j:"旅行証券のアップロード",
   he:"Please make sure the insurer, the plan name, what is covered, and the 24-hour assistance number are all readable.",`,
    `e:"Upload a photo or PDF of your travel insurance certificate",j:"旅行証券の写真またはPDFをアップロード",
   he:"Required because you answered Yes. Please make sure the insurer, plan name, coverage, and 24-hour assistance number are all readable.",`,
    'insurance upload wording',
  )
  source = replaceOnce(
    source,
    `spec:["JPEG, PNG, HEIC or PDF &nbsp;·&nbsp; up to 10MB each &nbsp;·&nbsp; up to 3 files",`,
    `spec:["Required if you answered Yes &nbsp;·&nbsp; JPEG, PNG, HEIC or PDF &nbsp;·&nbsp; up to 10MB each &nbsp;·&nbsp; up to 3 files",`,
    'insurance upload required note',
  )
  source = replaceOnce(
    source,
    `he:"Tick everyone sharing this room.",hj:"この部屋に同室となる方すべてにチェックしてください。",`,
    `he:"Names update automatically from Section 3. Tick everyone sharing this room.",hj:"氏名は第3セクションの入力から自動反映されます。この部屋に同室となる方すべてにチェックしてください。",`,
    'room name guidance',
  )

  const photoNotes = [
    `    if((f.items||[]).some(x=>x.img)) card.appendChild(html("p","imgnote",T("Photographs are for illustration only.","写真はイメージです。")));\n`,
    `    if((f.rows||[]).some(r=>r[2])) card.appendChild(html("p","imgnote",T("Photographs are for illustration only.","写真はイメージです。")));\n`,
    `      w.appendChild(el("p","imgnote",T("Photographs are for illustration only.","写真はイメージです。")));\n`,
    `    if(c.thumbs) box.appendChild(html("p","imgnote imgnote-row",T("Photographs are for illustration only.","写真はイメージです。")));\n`,
  ]
  photoNotes.forEach((note, index) => {
    source = removeOnce(source, note, `photo illustration note ${index + 1}`)
  })

  source = replaceOnce(
    source,
    `function travellerNames(){
  const n=REPS[3]||1, out=[], qn=nameQn();`,
    `function travellerNames(){
  const n=REPS[3]||1, out=[], qn=nameQn();
  const lead=[...document.querySelectorAll('[data-k^="q1_"]')]
    .map(x=>x.value.trim()).filter(Boolean).join(" ");`,
    'lead traveller name fallback',
  )
  source = replaceOnce(
    source,
    `    out.push(vals.length?vals.join(" "):label);`,
    `    out.push(vals.length?vals.join(" "):(i===0&&lead?lead:label));`,
    'traveller name resolution',
  )

  const fileStart = `  } else if(f.t==="file"){`
  const fileEnd = `  } else if(f.t==="select"){`
  const fileStartIndex = source.indexOf(fileStart)
  const fileEndIndex = source.indexOf(fileEnd, fileStartIndex)
  if (fileStartIndex < 0 || fileEndIndex < 0) {
    throw new Error('file input branch was not found')
  }
  const fileBranch = `  } else if(f.t==="file"){
    if(f.spec) card.appendChild(html("p","spec",T(f.spec[0],f.spec[1])));
    const i=document.createElement("input"); i.type="file"; i.className="nativefile";
    i.accept=f.accept||"image/*,.pdf";
    if(f.multiple) i.multiple=true;
    i.setAttribute("aria-label",T(f.multiple?"Choose files":"Choose file","ファイルを選択"));
    const pick=el("label","filepick");
    const choose=el("span","filebutton",T(f.multiple?"Choose files":"Choose file","ファイルを選択"));
    const status=el("span","filestatus",T("No file selected","ファイルが選択されていません"));
    const announce=()=>{
      const fs=[...i.files];
      status.textContent=fs.length===0?T("No file selected","ファイルが選択されていません"):
        fs.length===1?fs[0].name:T(fs.length+" files selected",fs.length+"件のファイルを選択済み");
      status.title=fs.map(x=>x.name).join(", ");
    };
    pick.appendChild(i); pick.appendChild(choose); pick.appendChild(status);
    const err=el("p","filerr");
    const MAX=10*1024*1024, MAXN=f.multiple?3:1;
    i.addEventListener("change",()=>{
      announce();
      const fs=[...i.files]; let msg="";
      if(fs.length>MAXN) msg=T("Please select up to "+MAXN+" file(s).","ファイルは"+MAXN+"つまでお選びください。");
      else{
        const big=fs.filter(x=>x.size>MAX);
        if(big.length) msg=T("This file is over 10MB: ","10MBを超えています：")+big.map(x=>x.name).join(", ");
      }
      err.textContent=msg; err.style.display=msg?"block":"none";
      if(msg){ i.value=""; announce(); }
    });
    err.style.display="none";
    card.appendChild(pick); card.appendChild(err);
`
  source = source.slice(0, fileStartIndex) + fileBranch + source.slice(fileEndIndex)

  return source
}
