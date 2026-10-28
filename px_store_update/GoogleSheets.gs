/**
 * Palengke Express activity log (Google Apps Script web app)
 * Target spreadsheet: https://docs.google.com/spreadsheets/d/1vXrp5mgSnwYKKQtb9GzKIp0QWT3PN6zgDCqMwQ8i7_o/edit
 * Paste this script into Extensions > Apps Script for that spreadsheet.
 * Set Script Property PX_WEBHOOK_SECRET to a random secret, identical to the
 * GOOGLE_SHEET_WEBHOOK_SECRET environment variable on your Node server.
 * Deploy > New deployment > Web app > Execute as Me > Anyone.
 * The URL is used only by the Node server, NEVER inside browser JavaScript.
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('PX_WEBHOOK_SECRET');
    if (!expected || data.secret !== expected) throw new Error('Unauthorized');
    const sheet = SpreadsheetApp.openById('1vXrp5mgSnwYKKQtb9GzKIp0QWT3PN6zgDCqMwQ8i7_o');
    let tab = sheet.getSheetByName('Activity Log');
    if (!tab) {
      tab = sheet.insertSheet('Activity Log');
      tab.appendRow(['Timestamp','Event','User ID','Role','Name','Email','Phone','Store Name','Store Location','Registration Type','License Type','Motorcycle Type','Vehicle Model','Plate Number','Approval Status','Reviewed By','Order ID','Status','Action','Amount (PHP)']);
      tab.setFrozenRows(1);
    }
    // Avoid interpreting input as spreadsheet formulas.
    const safe = x => {
      const v = String(x == null ? '' : x).slice(0,500);
      return /^[=+@\-\t\r]/.test(v) ? "'" + v : v;
    };
    tab.appendRow([safe(data.timestamp),safe(data.event),safe(data.userId),safe(data.role),
      safe(data.name),safe(data.email),safe(data.phone),safe(data.storeName),safe(data.storeLocation),safe(data.registrationType),safe(data.licenseType),safe(data.motorcycleType),safe(data.vehicleModel),safe(data.plateNumber),safe(data.approvalStatus),safe(data.reviewedBy),safe(data.orderId),safe(data.status),safe(data.action),
      Number.isFinite(Number(data.total)) && data.total != null ? Number(data.total) : '']);
    return ContentService.createTextOutput('OK');
  } catch(err) {
    // Apps Script ContentService has limited response status control.
    console.error('Rejected webhook: ' + err.message);
    return ContentService.createTextOutput('ERROR');
  }
}
