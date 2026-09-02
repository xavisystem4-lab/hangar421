# HANGAR 421 — Plan de implementación por fases

## Fase 0 — Fundaciones (este entregable)
- Monorepo, `packages/shared` (tipos/enums/DTOs/contratos de sync).
- Modelo de datos completo (Prisma) para toda la jerarquía empresa→sucursal→…→operación.
- Backend NestJS: auth (JWT + PIN + roles), empresas/sucursales, catálogo, mesas, pedidos,
  cocina (gateway realtime), caja/pagos, inventario básico, endpoint de sync (push/pull),
  reportes mínimos. Swagger en `/api/docs`.
- Seed demo: 1 empresa, 2 sucursales, catálogo de cafetería, usuarios de cada rol, mesas.

## Fase 1 — MVP funcional (alcance de esta entrega de código)
- **POS Windows** (Electron+React+SQLite): login, venta de mostrador y por mesa, catálogo con
  categorías/modificadores, panel de pedido persistente, envío a cocina, cobro (efectivo/
  tarjeta/mixto), apertura/corte de caja, cola de sync offline.
- **App meseros** (Expo/React Native): login PIN, mapa de mesas por estado, toma de pedido,
  envío a cocina, estado de pedidos, notificación de "listo", modo offline.
- **Pantalla de cocina** (React web): columnas por estado, tiempo real vía Socket.IO, alertas,
  filtro por estación, cambio de estado con botones grandes.
- **CRM web** (Next.js): login, dashboard con KPIs y estado de sincronización por sucursal,
  gestión básica de catálogo/sucursales/usuarios, reporte de ventas.
- Sincronización en tiempo real entre los 4 clientes y la nube (Socket.IO + push/pull REST).
- Inventario básico: insumos, receta, descuento automático al vender, alerta de stock mínimo.

## Fase 2 — Operación avanzada
- División de cuenta por persona/artículo, transferencia de mesa/mesero, reimpresión de
  tickets, integración física con impresora térmica y cajón de dinero (ESC/POS vía USB/red).
- Traspasos entre sucursales (flujo completo solicitud→autorización→envío→recepción→
  validación de diferencias) con UI dedicada en CRM y POS.
- Programa de lealtad y CRM de clientes (segmentación, historial, promociones).
- Reportes avanzados (por mesero, cajero, método de pago, comparativo entre sucursales),
  exportación CSV/PDF.
- Auto-actualización firmada del instalador Windows (`electron-updater` con firma de código).

## Fase 3 — Escala y endurecimiento
- Multi-tenant real (aislamiento por empresa a nivel de infraestructura si se vende a terceros).
- Observabilidad completa (métricas, tracing, alertado on-call), pruebas de carga.
- App meseros publicada en Play Store (`.aab`) además de la distribución interna `.apk`.
- Cifrado en reposo de la base local sensible, rotación de secretos, auditoría de seguridad
  externa antes de procesar pagos con proveedor certificado (PCI) si se agrega cobro con
  tarjeta integrado por hardware.

Cada fase es incremental sobre el modelo de datos ya definido en Fase 0 — no se planean
migraciones destructivas entre fases, solo adición de entidades/columnas.
