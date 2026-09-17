import { Injectable } from "@nestjs/common";
import {
  CredencialesPlataforma,
  PlataformaDeliveryAdapter,
  ResultadoPruebaConexionPlataforma,
  WebhookProcesadoPlataforma,
} from "./plataforma-delivery.interface";

/**
 * Adaptador sin plataforma real — para desarrollo local y pruebas automatizadas sin depender de
 * credenciales de DiDi/Uber/Rappi. No se ofrece en el selector del CRM (solo DIDI/UBER/RAPPI son
 * visibles ahí); útil para QA manual contra el backend embebido del POS o specs.
 */
@Injectable()
export class MockPlataformaAdapter implements PlataformaDeliveryAdapter {
  readonly codigo = "mock";
  readonly nombreVisible = "Plataforma de prueba";

  validarConfiguracion(): void {
    // No requiere credenciales.
  }

  campoPrincipalEnmascarado(): string {
    return "MOCK";
  }

  tieneClientSecret(): boolean {
    return true;
  }

  async probarConexion(): Promise<ResultadoPruebaConexionPlataforma> {
    return { ok: true, detalle: "Adaptador mock — sin conexión real" };
  }

  async procesarWebhook(
    _credenciales: CredencialesPlataforma,
    peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<WebhookProcesadoPlataforma> {
    const body = peticion.body as {
      eventoExternoId?: string;
      ordenExternaId?: string;
      tipoEvento?: string;
      estadoExterno?: string;
      clienteNombre?: string;
      total?: number;
      items?: { nombreExterno: string; cantidad: number; precioUnitario?: number; notas?: string }[];
    };
    const eventoExternoId = body.eventoExternoId ?? `mock-${Date.now()}`;
    if (!body.ordenExternaId) {
      return { eventoExternoId, orden: null };
    }
    return {
      eventoExternoId,
      orden: {
        ordenExternaId: body.ordenExternaId,
        tipoEvento: body.tipoEvento ?? "order.created",
        estadoExterno: body.estadoExterno ?? "recibido",
        clienteNombre: body.clienteNombre ?? "Cliente de prueba",
        total: body.total ?? null,
        items: body.items ?? [{ nombreExterno: "Producto de prueba", cantidad: 1 }],
        payloadSanitizado: { mock: true, items: body.items ?? [{ nombreExterno: "Producto de prueba", cantidad: 1 }] },
      },
    };
  }
}
