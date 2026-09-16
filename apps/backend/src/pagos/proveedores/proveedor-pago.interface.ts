/**
 * Contrato que debe implementar cada proveedor de cobro con tarjeta (Mercado Pago, un banco,
 * Stripe Terminal, etc.) — agregar un proveedor nuevo es escribir una clase que implemente esta
 * interfaz y registrarla en ProveedorPagoRegistry; el resto de PagosService no cambia.
 *
 * Las credenciales de cada instancia (access token, secretos, etc.) las inyecta PagosService al
 * llamar cada método, ya descifradas desde PaymentProviderConfig — el adaptador nunca las lee ni
 * las persiste por su cuenta.
 */

export interface CredencialesProveedor {
  ambiente: "PRUEBAS" | "PRODUCCION";
  identificadorComercio: string | null;
  webhookUrl: string | null;
  /** Contenido específico del proveedor (access token, public key, secretos webhook, etc.) —
   *  cada adaptador conoce las claves que necesita dentro de este objeto. */
  extra: Record<string, string>;
}

export interface TerminalExterna {
  identificadorExterno: string;
  nombre: string;
  estadoConexion: "CONECTADA" | "DESCONECTADA" | "OCUPADA" | "ERROR";
}

export interface SolicitudPagoInput {
  /** Lo que el proveedor debe usar como referencia externa — así el webhook se puede conciliar
   *  con nuestro PaymentRequest sin depender de que el proveedor devuelva rápido su propio id. */
  referenciaInterna: string;
  identificadorExternoTerminal: string;
  importe: number;
  moneda: string;
  descripcion?: string;
}

export interface SolicitudPagoResultado {
  /** id que el proveedor asigna a esta solicitud/intención de pago (ej. payment_intent id de
   *  Mercado Pago) — se guarda en PaymentRequest.referenciaExterna. */
  referenciaExterna: string;
  estado: "ENVIADO_A_TERMINAL" | "EN_PROCESO" | "ERROR";
  motivoError?: string;
}

export interface EstadoPagoConsultado {
  estado: "PENDIENTE" | "ENVIADO_A_TERMINAL" | "EN_PROCESO" | "APROBADO" | "RECHAZADO" | "CANCELADO" | "ERROR";
  motivoError?: string;
  /** Payload no sensible del proveedor, para guardar en PaymentEvent.payloadSanitizado — el
   *  adaptador es responsable de NUNCA incluir aquí datos de tarjeta (PAN, CVV, vencimiento). */
  payloadSanitizado?: Record<string, unknown>;
}

export interface WebhookProcesado {
  /** referenciaInterna que mandamos al crear la solicitud — permite ubicar el PaymentRequest. */
  referenciaInterna: string | null;
  referenciaExterna: string | null;
  estado: EstadoPagoConsultado["estado"];
  motivoError?: string;
  payloadSanitizado?: Record<string, unknown>;
}

export interface ResultadoPruebaConexion {
  ok: boolean;
  detalle: string;
}

export interface ProveedorPagoAdapter {
  /** Código único del adaptador — debe coincidir con `proveedor` en PaymentProviderConfig y
   *  PaymentTerminal/PaymentRequest (ej. "mercadopago", "mock"). */
  readonly codigo: string;

  /** Valida que `credenciales` traiga todo lo que este proveedor necesita — se llama al guardar
   *  la configuración desde Administración, antes de cifrarla. Lanza si falta algo. */
  validarConfiguracion(credenciales: CredencialesProveedor): void;

  /** Terminales visibles para esta cuenta/credenciales — usado por Administración para poblar
   *  el selector al dar de alta una PaymentTerminal (evita teclear el identificador a mano). */
  listarTerminales(credenciales: CredencialesProveedor): Promise<TerminalExterna[]>;

  crearSolicitudDePago(
    credenciales: CredencialesProveedor,
    input: SolicitudPagoInput,
  ): Promise<SolicitudPagoResultado>;

  cancelarSolicitudDePago(credenciales: CredencialesProveedor, referenciaExterna: string): Promise<void>;

  consultarEstadoDePago(
    credenciales: CredencialesProveedor,
    referenciaExterna: string,
  ): Promise<EstadoPagoConsultado>;

  /** `peticion.headers`/`query`/`body` = la request cruda del webhook tal como llegó — el
   *  adaptador DEBE verificar la firma aquí (con lo que traiga `headers`/`query`) y lanzar si no
   *  coincide; PagosController nunca confía en un webhook sin verificar. Mercado Pago, por
   *  ejemplo, manda la firma en `headers["x-signature"]` pero el id del recurso en
   *  `query["data.id"]`, no en el body — de ahí que se pasen los tres por separado. */
  procesarWebhook(
    credenciales: CredencialesProveedor,
    peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<WebhookProcesado>;

  probarConexion(credenciales: CredencialesProveedor): Promise<ResultadoPruebaConexion>;
}
