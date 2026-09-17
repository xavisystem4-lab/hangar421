import { Injectable, NotFoundException } from "@nestjs/common";
import { DidiAdapter } from "./didi.adapter";
import { UberAdapter } from "./uber.adapter";
import { RappiAdapter } from "./rappi.adapter";
import { MockPlataformaAdapter } from "./mock.adapter";
import { PlataformaDeliveryAdapter } from "./plataforma-delivery.interface";

/**
 * Punto único de extensión: agregar una plataforma de delivery nueva es escribir una clase que
 * implemente PlataformaDeliveryAdapter y añadirla aquí — PlataformasService, el controlador y el
 * resto del módulo solo conocen la interfaz, nunca una plataforma concreta. Mismo patrón que
 * `pagos/proveedores/proveedor-pago.registry.ts`.
 */
@Injectable()
export class PlataformaDeliveryRegistry {
  private readonly adaptadores: Map<string, PlataformaDeliveryAdapter>;

  constructor(didi: DidiAdapter, uber: UberAdapter, rappi: RappiAdapter, mock: MockPlataformaAdapter) {
    this.adaptadores = new Map<string, PlataformaDeliveryAdapter>([
      [didi.codigo, didi],
      [uber.codigo, uber],
      [rappi.codigo, rappi],
      [mock.codigo, mock],
    ]);
  }

  obtener(codigo: string): PlataformaDeliveryAdapter {
    const adaptador = this.adaptadores.get(codigo);
    if (!adaptador) throw new NotFoundException(`Plataforma de delivery "${codigo}" no está registrada`);
    return adaptador;
  }

  listarCodigos(): string[] {
    return Array.from(this.adaptadores.keys());
  }
}
