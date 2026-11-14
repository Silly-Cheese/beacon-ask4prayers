// Deploy as a web app running as the sender. Set BEACON_MAIL_SECRET in Script Properties.
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 16000) return response_(false);
    const request = JSON.parse(raw);
    if (!/^[0-9]{13}$/.test(request.timestamp) ||
        Math.abs(Date.now() - Number(request.timestamp)) > 5 * 60 * 1000 ||
        typeof request.payload !== 'string' || !/^[a-f0-9]{64}$/.test(request.signature))
      return response_(false);
    const properties = PropertiesService.getScriptProperties();
    const secret = properties.getProperty('BEACON_MAIL_SECRET');
    if (!secret) return response_(false);
    const signature = Utilities.computeHmacSha256Signature(request.timestamp + '.' + request.payload, secret)
      .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
    let difference = 0;
    for (let i = 0; i < signature.length; i++) difference |= signature.charCodeAt(i) ^ request.signature.charCodeAt(i);
    if (difference) return response_(false);

    const job = JSON.parse(request.payload);
    const message = message_(job);
    if (!message || !/^[A-Za-z0-9]{20}$/.test(job.id)) return response_(false);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const receipt = 'sent:' + job.id;
      if (properties.getProperty(receipt)) return response_(true);
      const cutoff = Date.now() - 7 * 86400000;
      const stored = properties.getProperties();
      for (const key of Object.keys(stored)) {
        if (key.startsWith('sent:') && Number(stored[key]) < cutoff) properties.deleteProperty(key);
      }
      if (MailApp.getRemainingDailyQuota() < 1) return response_(false);
      MailApp.sendEmail(message);
      properties.setProperty(receipt, String(Date.now()));
      return response_(true);
    } finally {
      lock.releaseLock();
    }
  } catch (_) {
    return response_(false);
  }
}

function response_(ok) {
  return ContentService.createTextOutput(JSON.stringify({ok})).setMimeType(ContentService.MimeType.JSON);
}

function escape_(value) {
  const replacements = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  return String(value).replace(/[&<>"']/g, character => replacements[character]);
}

function message_(job) {
  if (typeof job.recipient !== 'string' || job.recipient.length > 254 ||
      !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(job.recipient) || typeof job.url !== 'string')
    return null;
  const name = typeof job.studentName === 'string' ? job.studentName.slice(0, 120) : '';
  const templates = {
    verification: {
      title:'Verify your email', button:'Verify my email',
      copy:'Welcome to Beacon Scholars. Please verify your email to confirm that it belongs to you. Then return to Beacon to continue your application or nomination.',
      note:'If you didn’t create a Beacon account, you can ignore this email.',
      link:/^https:\/\/beacon-ask4prayers\.(firebaseapp\.com|web\.app)\/__\/auth\/action\?/
    },
    reference: {
      title:'You’ve been asked to provide a reference', button:'Open reference form',
      copy:name + ' listed you as a reference for Beacon Scholars, an honorary recognition program of The Prayer Project. We’d appreciate hearing about the student’s character, growth, or potential.',
      note:'Your response is confidential. This link can be used once and expires 14 days after it is issued.',
      link:/^https:\/\/beacon\.ask4prayers\.com\/#reference\/[\w-]{43}$/
    },
    guardian: {
      title:'Parent or guardian consent requested', button:'Review the consent form',
      copy:name + ' requested your permission to participate in Beacon Scholars, an honorary recognition program of The Prayer Project. Please review the information and complete the form if you consent.',
      note:'This link is for the parent or legal guardian. It can be used once and expires 14 days after it is issued.',
      link:/^https:\/\/beacon\.ask4prayers\.com\/#consent\/[\w-]{43}$/
    }
  };
  const template = Object.prototype.hasOwnProperty.call(templates,job.kind) ? templates[job.kind] : null;
  if (!template || !template.link.test(job.url)) return null;
  const {title,button,copy,note} = template;
  const safeUrl = escape_(job.url);
  return {
    to:job.recipient, name:'Beacon Scholars | The Prayer Project', subject:'Beacon Scholars • ' + title,
    body:[title,copy,button + ' ' + job.url,note,'Beacon Scholars | The Prayer Project'].join('\n\n'),
    htmlBody:'<div style="background:#f4efe5;padding:24px 12px;font-family:Arial,sans-serif;color:#29231e">' +
      '<table role="presentation" style="width:100%;max-width:580px;margin:auto;border-collapse:collapse;background:#fffdf8">' +
      '<tr><td style="background:#1c1713;color:#f3dfbd;padding:20px 28px;font-weight:bold;letter-spacing:1px">BEACON SCHOLARS</td></tr>' +
      '<tr><td style="padding:24px 28px"><h1 style="font: bold 28px Georgia,serif;margin:0 0 16px">' + escape_(title) + '</h1>' +
      '<p style="line-height:1.6">' + escape_(copy) + '</p>' +
      '<p style="margin:24px 0"><a style="display:inline-block;padding:12px 18px;background:#654c2e;color:#ffffff;text-decoration:none;border-radius:6px" href="' + safeUrl + '">' + escape_(button) + '</a></p>' +
      '<p style="font-size:14px;line-height:1.5;color:#554b40">' + escape_(note) + '</p>' +
      '<p style="font-size:13px;color:#554b40">The Prayer Project · Beacon Scholars</p></td></tr></table></div>'
  };
}
