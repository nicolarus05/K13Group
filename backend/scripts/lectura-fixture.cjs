// Archivo ficticio para el ensayo web aislado; salida binaria por stdout.
const X = require('xlsx');
const book = X.utils.book_new();
X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([
  ['Ensayo ficticio'], [], ['FECHA', 'NOMBRE', 'PAGO', 'P.AÑO', 'ESTADO', 'APP', 'SERVIDOR'],
  ['31/02/2026', 'Cliente ficticio de lectura', 'STR', 75, 'PE', 'MAXPLAYER', 'COBRA'],
  [], ['2026-10-16', null, 'PA', 0],
]), 'OCT');
process.stdout.write(X.write(book, { type: 'buffer', bookType: 'xlsx' }));
