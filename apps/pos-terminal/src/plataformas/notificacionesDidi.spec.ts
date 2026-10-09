import { aNumero, ameritaAviso, interpretarNotificacion, nombrePedidoDidi } from "./notificacionesDidi";

describe("interpretarNotificacion (app de DiDi en la misma tablet)", () => {
  it("reconoce un pedido nuevo con número, total y cliente", () => {
    const n = interpretarNotificacion({ titulo: "Nuevo pedido #1234", texto: "Cliente: Juan Pérez · Total: $180.00" });
    expect(n.esPedidoNuevo).toBe(true);
    expect(n.esRuido).toBe(false);
    expect(n.numeroPedido).toBe("1234");
    expect(n.total).toBe(180);
    expect(n.cliente).toBe("Juan Pérez");
    expect(n.resumen).toBe("Nuevo pedido DiDi #1234 · $180.00 · Juan Pérez");
    expect(nombrePedidoDidi(n)).toBe("DiDi #1234 Juan Pérez");
  });

  it("acepta otras redacciones: 'Tienes un pedido', 'orden', MXN y miles con coma", () => {
    const a = interpretarNotificacion({ titulo: "DiDi Food", texto: "¡Tienes un pedido nuevo! Orden 98765 por MXN 1,250.50" });
    expect(a.esPedidoNuevo).toBe(true);
    expect(a.numeroPedido).toBe("98765");
    expect(a.total).toBe(1250.5);

    const b = interpretarNotificacion({ titulo: "Nueva orden", texto: "Acepta el pedido A1B2C3 antes de que expire" });
    expect(b.esPedidoNuevo).toBe(true);
    expect(b.numeroPedido).toBe("A1B2C3");
    expect(b.total).toBeNull();
  });

  it("no confunde entregas, cancelaciones ni promociones con pedidos nuevos", () => {
    const entregado = interpretarNotificacion({ titulo: "Pedido #1234 entregado", texto: "El repartidor entregó el pedido" });
    expect(entregado.esPedidoNuevo).toBe(false);
    expect(entregado.esRuido).toBe(true);
    expect(ameritaAviso(entregado)).toBe(false);

    const promo = interpretarNotificacion({ titulo: "Promoción", texto: "Activa 2x1 este fin de semana" });
    expect(promo.esRuido).toBe(true);
  });

  it("una notificación desconocida llega con su texto y amerita aviso (por si DiDi cambió el formato)", () => {
    const n = interpretarNotificacion({ titulo: "DiDi Comercios", texto: "Hay algo pendiente en tu tienda" });
    expect(n.esPedidoNuevo).toBe(false);
    expect(n.esRuido).toBe(false);
    expect(ameritaAviso(n)).toBe(true);
    expect(n.resumen).toBe("DiDi Comercios — Hay algo pendiente en tu tienda");
  });

  it("nombrePedidoDidi sin número ni cliente es solo 'DiDi'", () => {
    expect(nombrePedidoDidi(interpretarNotificacion({ titulo: "Nuevo pedido", texto: "" }))).toBe("DiDi");
  });
});

describe("aNumero", () => {
  it("entiende separadores de miles y decimales en los dos estilos", () => {
    expect(aNumero("180")).toBe(180);
    expect(aNumero("1,250.50")).toBe(1250.5);
    expect(aNumero("1.250,50")).toBe(1250.5);
    expect(aNumero("180.5")).toBe(180.5);
    expect(aNumero("abc")).toBeNull();
  });
});
