// PostToolUse hook — Edit/Write ile bir js/**/*.js (ileride server/**/*.js)
// dosyası değiştiğinde `node --check` ile syntax hatasını hemen yakalar.
// jq'ya bağımlı değil (bu makinede kurulu değil) — hook input JSON'ını
// doğrudan Node ile stdin'den okuyup parse ediyor.
'use strict';

var chunks = [];
process.stdin.on('data', function (c) { chunks.push(c); });
process.stdin.on('end', function () {
  var filePath;
  try {
    var input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    filePath = input.tool_input && input.tool_input.file_path;
  } catch (e) {
    return; // hook input parse edilemedi, sessizce çık
  }
  if (!filePath || !/\.js$/i.test(filePath)) return;
  if (!/[\\/](js|server)[\\/]/.test(filePath)) return; // sadece js/ ve (ileride) server/

  var { spawnSync } = require('child_process');
  var result = spawnSync(process.execPath, ['--check', filePath], { stdio: 'inherit' });
  process.exit(result.status || 0);
});
