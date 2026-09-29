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

export function applyPostOrderSurveyNameFix(input) {
  let source = replaceOnce(input,
    'cells:[["First name","名"],["Last name(s)","姓"],["Middle name","ミドルネーム"]]',
    'optionalCells:[2],cells:[["First name","名"],["Last name(s)","姓"],["Middle name","ミドルネーム"]]',
    'optional middle name definition')
  source = replaceOnce(source,
    '      inp.dataset.k=QKEY+"_"+i;\n      if(f.unit',
    `      inp.dataset.k=QKEY+"_"+i;
      if(f.optionalCells){
        const optional=f.optionalCells.includes(i);
        inp.dataset.optional=String(optional);
        inp.setAttribute("aria-required",String(!!f.r&&!optional));
        if(optional) inp.placeholder=T("Optional","任意");
      }
      if(f.unit`,
    'optional row control metadata')
  source = replaceOnce(source,
    '      const filled=ins.some(x=>(x.type==="checkbox"||x.type==="radio")?x.checked:!!x.value)',
    `      const filled=ins.some(x=>x.dataset.optional!==undefined)
        ? ins.filter(x=>x.dataset.optional!=="true").every(x=>!!x.value.trim())
        : ins.some(x=>(x.type==="checkbox"||x.type==="radio")?x.checked:!!x.value)`,
    'name progress matches required fields')
  return source
}

export function applyPostOrderSurveyReview(input) {
  let source = input

  // Keep the approved 53-question production model when the external reference changes.
  source = replaceOnce(source, "  <div class=\"seg\" role=\"group\" aria-label=\"Language\">\n    <button type=\"button\" data-lang-btn=\"en\" aria-pressed=\"true\">English</button>\n    <button type=\"button\" data-lang-btn=\"ja\" aria-pressed=\"false\">日本語（確認用）</button>\n  </div>\n", "", "preserve English-only published header");
  source = replaceOnce(source, "  {t:\"text\",copyable:1,showIf:[\"wcType\",[\"Powered wheelchair\",\"Mobility scooter\"]],e:\"Make and model\",j:\"メーカー・型番\",r:1,ph:\"Permobil M3 Corpus\",\n   nj:\"電動車椅子・電動スクーターのみ聞く。手動・歩行器・杖はメーカーが分かっても手配判断が変わらないため表示しない。\"},\n  {t:\"row\",copyable:1,showIf:[\"wcType\",[\"Powered wheelchair\",\"Mobility scooter\"]],e:\"Dimensions\",j:\"サイズ\",\n   he:\"The manufacturer's figures are fine.\",hj:\"カタログ値で構いません。\",r:1,k:1,unit:[\"cm\",\"cm\",\"cm\"],\n   cells:[[\"Length\",\"縦（全長）\",\"number\",null,\"full\"],[\"Width\",\"横（全幅）\",\"number\",null,\"full\"],[\"Height\",\"高さ\",\"number\",null,\"full\"]],\n   nj:\"電動は大型で車両の開口部・客室扉の判定に寸法が要る。手動・歩行器・杖は規格内に収まるため聞かない。\"},\n", "  {t:\"text\",copyable:1,showIf:[\"wcType\",[\"Manual wheelchair\",\"Powered wheelchair\",\"Mobility scooter\",\"Rollator / walker\"]],e:\"Make and model\",j:\"メーカー・型番\",r:1,ph:\"Permobil M3 Corpus\",\n   nj:\"手動・電動・スクーター・歩行器はいずれも、車両積載と取り違え防止のためメーカー・型番を取得する。杖だけは対象外。\"},\n  {t:\"row\",copyable:1,showIf:[\"wcType\",[\"Manual wheelchair\",\"Powered wheelchair\",\"Mobility scooter\",\"Rollator / walker\"]],e:\"Dimensions\",j:\"サイズ\",\n   he:\"The manufacturer's figures are fine.\",hj:\"カタログ値で構いません。\",r:1,k:1,unit:[\"cm\",\"cm\",\"cm\"],\n   cells:[[\"Length\",\"縦（全長）\",\"number\",null,\"full\"],[\"Width\",\"横（全幅）\",\"number\",null,\"full\"],[\"Height\",\"高さ\",\"number\",null,\"full\"]],\n   nj:\"手動を含む車椅子と歩行器は、車両の開口部・リフト・荷室への適合確認に寸法が要る。杖だけは対象外。\"},\n", "preserve published mobility requirements");
  source = replaceOnce(source, "  {t:\"radio\",id:\"hoistdemo\",showIf:[\"hoist\",[\"Already arranged\",\"Please arrange\"]],e:\"Would you like the delivery staff to show you how to use the hoist?\",j:\"リフト搬入時の説明について\",r:1,k:1,\n   he:\"The staff who deliver the hoist can run through how to set it up and operate it. They speak Japanese, so the explanation would be given through a translation app.\",\n   hj:\"リフトを搬入するスタッフが、設置方法と操作方法をご説明できます。スタッフの対応言語は日本語のため、ご説明は翻訳アプリを介してのご案内となります。\",\n   o:[[\"Yes, please\",\"説明を希望する\"],[\"No, we are used to it\",\"説明不要\"]],\n   nj:\"搬入スタッフの滞在時間が変わるため、事業者への手配時点で要否が要る。日本語対応であることを先に伝えておかないと、当日『英語で説明されると思っていた』というクレームになる。\"},\n", "", "preserve published question numbering");

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
    i.multiple=true;
    i.setAttribute("aria-label",T("Add files","ファイルを追加"));
    const pick=el("label","filepick");
    const choose=el("span","filebutton",T("Add files","ファイルを追加"));
    const status=el("span","filestatus",T("No file selected","ファイルが選択されていません"));
    pick.appendChild(i); pick.appendChild(choose); pick.appendChild(status);
    const err=el("p","filerr");
    err.style.display="none";
    card.appendChild(pick); card.appendChild(err);
`
  source = source.slice(0, fileStartIndex) + fileBranch + source.slice(fileEndIndex)

  // These limits apply to every attachment question, including every traveller.
  source = source.replaceAll('up to 10MB each', 'up to 25 MiB (26.2 MB) per file')
    .replaceAll('up to 10MB', 'up to 25 MiB (26.2 MB) per file')
    .replaceAll('up to 3 photos', 'no file-count limit')
    .replaceAll('up to 3 files', 'no file-count limit')
    .replaceAll('1枚10MBまで ／ 3枚まで', '1ファイル25 MiB（約26.2 MB）まで ／ 件数制限なし')
    .replaceAll('1ファイル10MBまで ／ 3ファイルまで', '1ファイル25 MiB（約26.2 MB）まで ／ 件数制限なし')
    .replaceAll('10MBまで ／', '1ファイル25 MiB（約26.2 MB）まで ／ 件数制限なし ／')
    .replaceAll('JPEG, PNG or HEIC', 'JPEG, PNG, HEIC/HEIF, WebP, GIF, TIFF, BMP or AVIF')
    .replaceAll('JPEG, PNG, HEIC or PDF', 'JPEG, PNG, HEIC/HEIF, WebP, GIF, TIFF, BMP, AVIF or PDF')
    .replaceAll('JPEG・PNG・HEIC', 'JPEG・PNG・HEIC/HEIF・WebP・GIF・TIFF・BMP・AVIF')
    .replaceAll('image/jpeg,image/png,image/heic,image/heif', 'image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif,image/tiff,image/bmp,image/avif');
  source = source.replace('up to 25 MiB (26.2 MB) per file &nbsp;·&nbsp; make sure',
    'up to 25 MiB (26.2 MB) per file &nbsp;·&nbsp; no file-count limit &nbsp;·&nbsp; make sure');
  source = source.replace('accept:"image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif,image/tiff,image/bmp,image/avif,application/pdf",\n',
    'accept:"image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif,image/tiff,image/bmp,image/avif,application/pdf",multiple:1,\n');

  return applyPostOrderSurveyNameFix(source)
}
