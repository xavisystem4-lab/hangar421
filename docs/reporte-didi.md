# Reporte DiDi — ganancia real

ERP → **Reportes → 🛵 DiDi**. Muestra lo vendido en DiDi Food (ventas cobradas con canal
`PLATAFORMA_DELIVERY`, las que la tablet cobra desde el grupo DIDI) y cuánto le queda de verdad
al negocio después de la comisión. También aparece como tarjeta "🛵 Vendido en DiDi" en
**Ventas** y en **Reportes → Ventas**.

## Regla (`packages/shared/src/comisionPlataforma.ts`)

La comisión de DiDi es un porcentaje plano que se resta de la cuenta total, según cómo pagó el
cliente:

| Pago del cliente | Comisión DiDi | De $100 queda |
|---|---|---|
| Tarjeta / pagado en la app (`EN_LINEA`, `TARJETA`, transferencia…) | 43 % | $57 |
| Efectivo (`EFECTIVO`, `EFECTIVO_USD`) | 35 % | $65 |

```
base      = pagado por el cliente + subsidio de DiDi
comisión  = base × % del tipo de pago
ganancia  = base − comisión
```

- **Promociones**: las registra la tablet como descuento del ticket (precio de lista − pagado);
  la comisión se calcula sobre lo que pagó el cliente.
- **Subsidio de DiDi**: la venta no lo trae; se captura por producto en "Configurar comisión y
  subsidios" (pesos por unidad). Se aplica a todas las ventas del producto en el rango, así que
  conviene quitarlo cuando termine la promoción.
- **Pago mixto**: cada parte se calcula con su porcentaje.
- La ganancia es lo que DiDi paga al negocio; no descuenta el costo de los insumos.

Configuración: tabla `config_comision_plataforma` (una fila por empresa y plataforma, columnas
`comisionEnLineaPct` y `comisionEfectivoPct`). Solo ADMIN_CORPORATIVO la cambia
(`PUT /reportes/didi/config`); el reporte es `GET /reportes/didi`.
