import { Injectable } from "@nestjs/common";
import {
  CredencialesProveedor,
  EstadoPagoConsultado,
  ProveedorPagoAdapter,
  ResultadoPruebaConexion,
  SolicitudPagoInput,
  SolicitudPagoResultado,
  TerminalExterna,
  WebhookProcesado,
} from "./proveedor-pago.interface";

/**
 * Adaptador sin proveedor real — para desarrollo local y pruebas automatizadas sin depender de
 * credenciales de Mercado Pago. Simula: crear la solicitud queda "EN_PROCESO", y expone un
 * método `resolverManual()` (usado solo por PagosService en modo prueba/testing) para simular
 * la llegada de un webhook de aprobado/rechazado.
 */
@Injectable()
export class MockPagoAdapter implements ProveedorPagoAdapter {
  readonly codigo = "mock";

  validarConfiguracion(): void {
    // No requiere credenciales.
  }

  async listarTerminales(): Promise<TerminalExterna[]> {
    return [{ identificadorExterno: "MOCK-TERMINAL-1", nombre: "Terminal de prueba", estadoConexion: "CONECTADA" }];
  }

  async crearSolicitudDePago(
    _credenciales: CredencialesProveedor,
    input: SolicitudPagoInput,
  ): Promise<SolicitudPagoResultado> {
    return { referenciaExterna: `mock_${input.referenciaInterna}`, estado: "EN_PROCESO" };
  }

  async cancelarSolicitudDePago(): Promise<void> {
    // no-op
  }

  async consultarEstadoDePago(): Promise<EstadoPagoConsultado> {
    return { estado: "EN_PROCESO" };
  }

  async procesarWebhook(
    _credenciales: CredencialesProveedor,
    peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<WebhookProcesado> {
    const body = peticion.body as { referenciaInterna?: string; referenciaExterna?: string; estado?: string };
    return {
      referenciaInterna: body.referenciaInterna ?? null,
      referenciaExterna: body.referenciaExterna ?? null,
      estado: (body.estado as WebhookProcesado["estado"]) ?? "APROBADO",
    };
  }

  async probarConexion(): Promise<ResultadoPruebaConexion> {
    return { ok: true, detalle: "Adaptador mock — sin conexión real" };
  }
}
