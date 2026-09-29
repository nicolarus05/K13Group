/** Copia inmutable al registrar la operación, nunca al consultar ni al cobrar. */
export function attribution(productoId: string, servidorId: string, referenciaId: string | null) {
  return {
    atribucionVerificada: true,
    productoIdSnapshot: productoId,
    servidorIdSnapshot: servidorId,
    referenciaIdSnapshot: referenciaId,
  };
}
