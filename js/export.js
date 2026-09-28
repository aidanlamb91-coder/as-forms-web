/**
 * Client-side export: claim JSON + receipt files as a zip.
 */
(function (global) {
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function safeName(s) {
    return String(s || 'claim').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  }

  function claimFolderName(claim) {
    const job = safeName(claim.jobNo || 'job');
    const from = claim.dateFrom || 'from';
    const to = claim.dateTo || 'to';
    return 'Expense_' + job + '_' + from + '_' + to;
  }

  function claimToJson(claim) {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: 'as-forms-web',
      claim: {
        id: claim.id,
        jobNo: claim.jobNo,
        name: claim.name,
        sendTo: claim.sendTo,
        dateFrom: claim.dateFrom,
        dateTo: claim.dateTo,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
        lines: (claim.lines || []).map((line, idx) => ({
          index: idx + 1,
          date: line.date,
          jobNo: line.jobNo,
          description: line.description,
          foreignCurrency: line.foreignCurrency || '',
          net: line.net,
          vat: line.vat,
          total: line.total,
          receipt: line.receiptMeta
            ? {
                fileName: line.receiptMeta.name,
                type: line.receiptMeta.type,
                size: line.receiptMeta.size,
                id: line.receiptId,
              }
            : null,
        })),
      },
    };
  }

  async function exportClaimZip(claim) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    const zip = new JSZip();
    const folder = claimFolderName(claim);
    const root = zip.folder(folder);
    root.file('claim.json', JSON.stringify(claimToJson(claim), null, 2));

    const receipts = root.folder('receipts');
    let i = 0;
    for (const line of claim.lines || []) {
      if (!line.receiptId) continue;
      i += 1;
      const rcpt = await AsStorage.getReceipt(line.receiptId);
      if (!rcpt || !rcpt.blob) continue;
      const ext = (rcpt.name && rcpt.name.includes('.'))
        ? rcpt.name.slice(rcpt.name.lastIndexOf('.'))
        : (rcpt.type === 'application/pdf' ? '.pdf' : '.jpg');
      const base = String(i).padStart(2, '0') + '_' + safeName(line.description || 'receipt');
      receipts.file(base + ext, rcpt.blob);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, folder + '.zip');
    return folder + '.zip';
  }

  async function exportFilledDocx(claim) {
    const blob = await AsDocxFiller.fillExpenseClaim({
      name: claim.name,
      sendTo: claim.sendTo || AsStorage.getSettings().sendTo,
      dateFrom: claim.dateFrom,
      dateTo: claim.dateTo,
      lines: (claim.lines || []).map((l) => ({
        date: l.date,
        jobNo: l.jobNo,
        description: l.description,
        foreignCurrency: l.foreignCurrency || '',
        net: l.net,
        vat: l.vat,
        total: l.total != null && l.total !== ''
          ? l.total
          : ((Number(l.net) || 0) + (Number(l.vat) || 0) || null),
      })),
    });
    const name = claimFolderName(claim) + '.docx';
    downloadBlob(blob, name);
    return name;
  }

  global.AsExport = {
    downloadBlob,
    exportClaimZip,
    exportFilledDocx,
    claimFolderName,
  };
})(window);
