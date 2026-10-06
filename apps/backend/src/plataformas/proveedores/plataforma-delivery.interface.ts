/**
 * Contrato que debe implementar cada plataforma de delivery (DiDi, Uber, Rappi) — agregar una
 * plataforma nueva es escribir una clase que implemente esta interfaz y registrarla en
 * PlataformaDeliveryRegistry; el resto de PlataformasService no cambia. Mismo patrón que
 * `pagos/proveedores/proveedor-pago.interface.ts`.
 *
 * Las credenciales de cada instancia (api key/client id, client secret, webhook secret, etc.) las
 * inyecta PlataformasService al llamar cada método, ya descifradas desde PlataformaConfig — el
 * adaptador nunca las lee ni las persiste por su cuenta.
 */

export interface CredencialesPlataforma {
  ambiente: "SANDBOX" | "PRODUCCION";
  identificadorTienda: string | null;
  /** Contenido específico de la plataforma (apiKey/clientId, clientSecret, webhookSecret, etc.)
   *  — cada adaptador conoce las claves que necesita dentro de este objeto. */
  extra: Record<string, string>;
}

export interface ResultadoPruebaConexionPlataforma {
  ok: boolean;
  detalle: string;
}

export interface ItemOrdenExterna {
  nombreExterno: string;
  cantidad: number;
  precioUnitario?: number;
  notas?: string;
  /** Opciones elegidas por el cliente ("Leche de avena", "Extra shot") tal como las nombra la
   *  plataforma — solo para mostrarlas; el cajero las traslada a la nota del item al aceptar. */
  modificadores?: string[];
}

/** Datos de entrega que la plataforma comparte con el comercio. Solo lo que la API autoriza;
 *  nunca se guardan teléfonos completos ni direcciones exactas del cliente (ver cada adaptador). */
export interface EntregaOrdenExterna {
  /** "DELIVERY" (reparte la plataforma), "PICKUP" (el cliente recoge), u otro valor de la API. */
  tipo?: string | null;
  repartidor?: string | null;
  /** ISO 8601 — hora estimada de recolección/entrega que reporta la plataforma. */
  horaEstimada?: string | null;
  /** Código de entrega para el repartidor (Rappi handoff, Uber display id…). */
  codigoEntrega?: string | null;
}

export interface MontosOrdenExterna {
  subtotal?: number | null;
  envio?: number | null;
  propina?: number | null;
  descuento?: number | null;
}

/** Resultado de aceptar/rechazar una orden en la API de la plataforma. */
export interface ResultadoAccionPlataforma {
  /** true = la plataforma respondió OK. false = falló (el detalle dice qué hacer). */
  ok: boolean;
  detalle: string;
}

export interface OrdenExternaEntrante {
  ordenExternaId: string;
  tipoEvento: string;
  estadoExterno: string;
  /** Nombre del cliente tal como lo manda la plataforma — solo para mostrarlo en la bandeja de
   *  "Pedidos entrantes" del CRM, nunca se usa para crear un Cliente real (ver
   *  PlataformasService.aceptarPedido: el Pedido resultante se crea sin clienteId). */
  clienteNombre?: string | null;
  total?: number | null;
  /** Items tal como los mandó la plataforma (nombre/cantidad propios de su catálogo, NO
   *  productoId del catálogo de HANGAR 421) — el cajero los mapea a mano a un Producto real al
   *  aceptar el pedido (ver PlataformasService.aceptarPedido), porque no hay forma automática de
   *  saber que "Latte grande" en DiDi es el mismo producto que "Café Latte (G)" en el catálogo. */
  items?: ItemOrdenExterna[];
  /** Folio corto que el comercio ve en la tablet de la plataforma (display id). */
  folioCorto?: string | null;
  notas?: string | null;
  entrega?: EntregaOrdenExterna | null;
  montos?: MontosOrdenExterna | null;
  /** true = este evento CANCELA la orden (cliente, repartidor, expiración del tiempo para
   *  aceptar). El servicio la pasa a CANCELADA si aún no se aceptó. */
  cancelada?: boolean;
  /** Payload no sensible, para guardar en PlataformaWebhookEvent/PlataformaOrdenSync — el
   *  adaptador es responsable de no incluir aquí datos que no deban persistirse. */
  payloadSanitizado: Record<string, unknown>;
}

export interface WebhookProcesadoPlataforma {
  /** Id de evento que asigna la plataforma externa — clave de idempotencia (ver
   *  PlataformaWebhookEvent.eventoExternoId). Si el adaptador no puede reconocer un id de evento
   *  en el payload, debe lanzar — sin id no se puede garantizar idempotencia. */
  eventoExternoId: string;
  /** null = evento sin orden asociada (ping/healthcheck de la plataforma) — se registra como
   *  procesado pero no genera un PlataformaOrdenSync. */
  orden: OrdenExternaEntrante | null;
}

export interface PlataformaDeliveryAdapter {
  /** Código único del adaptador — debe coincidir con `plataforma` en PlataformaConfig (ej.
   *  "didi", "uber", "rappi", "mock"). */
  readonly codigo: string;

  /** Nombre para mostrar en el CRM (ej. "DiDi Food", "Uber Eats", "Rappi"). */
  readonly nombreVisible: string;

  /** Valida que `credenciales` traiga todo lo que esta plataforma necesita — se llama al guardar
   *  la configuración desde Administración, antes de cifrarla. Lanza si falta algo. */
  validarConfiguracion(credenciales: CredencialesPlataforma): void;

  /** Últimos 4 caracteres del campo principal (apiKey/clientId) — lo único que el CRM puede
   *  mostrar de vuelta sin exponer el secreto completo. */
  campoPrincipalEnmascarado(credenciales: CredencialesPlataforma): string;

  tieneClientSecret(credenciales: CredencialesPlataforma): boolean;

  probarConexion(credenciales: CredencialesPlataforma): Promise<ResultadoPruebaConexionPlataforma>;

  /** `peticion.headers`/`query`/`body` = la request cruda del webhook tal como llegó — el
   *  adaptador DEBE verificar la firma aquí y lanzar si no coincide; PlataformasController nunca
   *  confía en un webhook sin verificar (ver PlataformasService.manejarWebhook(), que además
   *  nunca deja que este throw se convierta en un 500 — lo atrapa y responde 200 igual, para no
   *  provocar una tormenta de reintentos del proveedor). */
  procesarWebhook(
    credenciales: CredencialesPlataforma,
    peticion: PeticionWebhook,
  ): Promise<WebhookProcesadoPlataforma>;

  /** Acepta la orden en la plataforma. Opcional: si el adaptador no lo implementa (o devuelve
   *  `null` porque falta configuración del backend), la aceptación solo puede registrarse como
   *  MANUAL — el cajero confirma que ya la aceptó en la tablet/portal de la plataforma. */
  aceptarOrden?(credenciales: CredencialesPlataforma, ordenExternaId: string): Promise<ResultadoAccionPlataforma | null>;

  /** Plataformas que mandan TODAS sus tiendas a una sola URL (DiDi): id de tienda del evento,
   *  para enrutarlo a la configuración de la sucursal que tenga ese id. */
  tiendaDelWebhook?(peticion: PeticionWebhook): string | null;

  /** Cuerpo de respuesta que la plataforma espera (DiDi: {"errno":0,"errmsg":"ok"}). Default:
   *  {ok:true}. `exito = false` solo cuando NO se pudo guardar el evento (para que reintente). */
  respuestaWebhook?(exito: boolean): unknown;

  /** Rechaza la orden en la plataforma. Mismo contrato que `aceptarOrden`. */
  rechazarOrden?(credenciales: CredencialesPlataforma, ordenExternaId: string, motivo: string): Promise<ResultadoAccionPlataforma | null>;
}

export interface PeticionWebhook {
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  /** Body EXACTO como llegó (antes de parsear el JSON). Las firmas HMAC de Uber y Rappi se
   *  calculan sobre estos bytes: re-serializar el JSON cambia espacios/orden y la firma no cuadra. */
  rawBody?: string;
}
