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
    `:root{\n  --ink:#1c2b33;`,
    `:root{color-scheme:light;\n  --ink:#1c2b33;`,
    'light color scheme',
  )
  source = removeOnce(
    source,
    `:root:not([data-theme="light"]){@media (prefers-color-scheme:dark){\n  --ink:#e8e6e1; --ink-2:#b2bcc0; --ink-3:#8b979c;\n  --ground:#14191c; --card:#1b2226; --rule:#2e373c;\n  --accent:#7cc0ae; --accent-soft:#1c2725; --ku-line:#3c5b53;\n  --amber:#d8b478; --amber-soft:#2a241a;\n  --key:#d99878; --key-soft:#2b201b;\n}}\n`,
    'automatic dark palette',
  )
  source = removeOnce(
    source,
    `:root[data-theme="dark"]{\n  --ink:#e8e6e1; --ink-2:#b2bcc0; --ink-3:#8b979c;\n  --ground:#14191c; --card:#1b2226; --rule:#2e373c;\n  --accent:#7cc0ae; --accent-soft:#1c2725; --ku-line:#3c5b53;\n  --amber:#d8b478; --amber-soft:#2a241a;\n  --key:#d99878; --key-soft:#2b201b;\n}\n`,
    'explicit dark palette',
  )
  source = removeOnce(
    source,
    `:root[data-theme="dark"] .seg button[aria-pressed="true"]{color:#0f1517}\n`,
    'explicit dark language toggle color',
  )
  source = removeOnce(
    source,
    `@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) .seg button[aria-pressed="true"]{color:#0f1517}}\n`,
    'automatic dark language toggle color',
  )
  source = removeOnce(
    source,
    `@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) .num{color:#0f1517}}\n`,
    'automatic dark section number color',
  )
  source = removeOnce(
    source,
    `:root[data-theme="dark"] .num{color:#0f1517}\n`,
    'explicit dark section number color',
  )
  source = removeOnce(
    source,
    `@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) .filerr{color:#f2b8b5}}\n`,
    'automatic dark file error color',
  )
  source = removeOnce(
    source,
    `:root[data-theme="dark"] .filerr{color:#f2b8b5}\n`,
    'explicit dark file error color',
  )
  source = removeOnce(
    source,
    `@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) button.submit{color:#0f1517}}\n`,
    'automatic dark submit color',
  )
  source = removeOnce(
    source,
    `:root[data-theme="dark"] button.submit{color:#0f1517}\n`,
    'explicit dark submit color',
  )

  source = replaceOnce(
    source,
    `.barin{max-width:820px;`,
    `.barin{max-width:980px;`,
    'desktop header width',
  )
  source = replaceOnce(
    source,
    `.wrap{max-width:820px;`,
    `.wrap{max-width:980px;`,
    'desktop form width',
  )

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
.filestatus{min-width:0;color:var(--ink-2);font-size:13.5px;line-height:1.5;overflow-wrap:anywhere}
.filepick:has(.nativefile:focus-visible){outline:2px solid var(--accent);outline-offset:2px;border-color:transparent}
@media(max-width:560px){.filepick{align-items:flex-start;flex-direction:column}.filebutton{width:100%}}`,
    'custom English file picker styles',
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
