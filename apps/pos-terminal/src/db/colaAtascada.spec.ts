import { descartarProblema, moverProblemaASucursalActual } from "./outboxRepo";

/**
 * Una venta encolada cuando la tablet estaba enlazada a otra sucursal es rechazada por el ERP
 * para siempre ("No tienes acceso a esta sucursal"). Pasó en producción: tres eventos de
 * Mecanicos atascados en una tablet de Benito Juárez, con el aviso rojo saliendo cada vez.
 *
 * Aquí se fija cómo se desatasca: reasignarla a la sucursal de hoy (si de verdad pasó aquí) o
 * sacarla de la cola (si fue una prueba), sin tocar jamás una de la propia sucursal.
 */
function baseFalsa(fila: { sucursal_id: string; ultimo_error: string | null } | null) {
  const ejecutados: { sql: string; params: any[] }[] = [];
  return {
    db: {
      getFirstAsync: jest.fn(async () => fila),
      runAsync: jest.fn(async (sql: string, ...params: any[]) => { ejecutados.push({ sql, params }); }),
    } as any,
    ejecutados,
  };
}

describe("moverProblemaASucursalActual", () => {
  it("reasigna el evento de otra sucursal y lo devuelve a la cola", async () => {
    const { db, ejecutados } = baseFalsa({ sucursal_id: "mecanicos", ultimo_error: "No tienes acceso a esta sucursal" });
    expect(await moverProblemaASucursalActual(db, "ev-1", "benito")).toBe(true);
    expect(ejecutados[0].sql).toContain("UPDATE sync_outbox SET sucursal_id = ?");
    expect(ejecutados[0].sql).toContain("estado = 'PENDING'");
    expect(ejecutados[0].params).toEqual(["benito", "ev-1"]);
  });

  it("no toca un evento que ya es de la sucursal actual (el rechazo tendría otra causa)", async () => {
    const { db, ejecutados } = baseFalsa({ sucursal_id: "benito", ultimo_error: "Producto inexistente" });
    expect(await moverProblemaASucursalActual(db, "ev-1", "benito")).toBe(false);
    expect(ejecutados).toHaveLength(0);
  });

  it("no hace nada si el evento ya no está en error", async () => {
    const { db, ejecutados } = baseFalsa(null);
    expect(await moverProblemaASucursalActual(db, "ev-1", "benito")).toBe(false);
    expect(ejecutados).toHaveLength(0);
  });
});

describe("descartarProblema", () => {
  it("solo borra el envío en error, no la venta guardada en la tablet", async () => {
    const { db, ejecutados } = baseFalsa(null);
    await descartarProblema(db, "ev-1");
    expect(ejecutados[0].sql).toBe("DELETE FROM sync_outbox WHERE local_id = ? AND estado = 'ERROR'");
    expect(ejecutados[0].params).toEqual(["ev-1"]);
  });
});
