package expo.modules.hangarusbprinter

import android.content.Context
import android.graphics.BitmapFactory
import expo.modules.hangarusbprinter.TicketBuilder.Align
import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs

/**
 * Traduce el TicketPayload de la app (llega como JSON desde src/printing/usbPrinterAdapter.ts)
 * al orden del ticket: logo → negocio → folio/fecha → productos → totales → pie → QR → código
 * de barras del folio → corte. Lo que no venga en el JSON simplemente no se imprime.
 *
 * El formato de la fecha llega ya hecho desde JavaScript (`fechaTexto`) para que sea idéntico
 * al del recibo en pantalla y no depender de java.time (minSdk 23).
 */
class TicketRenderer(private val context: Context, private val cfg: ConfigImpresora, anchoMM: Int) {
    private val columnas = if (anchoMM == 58) 32 else 48
    private val puntos = if (anchoMM == 58) 384 else 576

    private fun nuevo() = TicketBuilder(codePage = cfg.codePage, lineWidth = columnas, quitarAcentos = cfg.quitarAcentos).init()

    fun ticketVenta(t: JSONObject): ByteArray {
        val b = nuevo()
        encabezado(b, t)

        b.setAlign(Align.LEFT)
        b.leftRight("Folio: ${t.optInt("folio")}", t.optString("fechaTexto"))
        t.texto("cajero")?.let { b.line("Atendió: $it") }
        b.separator()

        b.setBold(true).rowHeader().setBold(false)
        val items = t.optJSONArray("items")
        if (items != null) {
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                b.row(cantidad(item.optDouble("cantidad", 1.0)), item.optString("nombre"), dinero(item.optDouble("precioTotal", 0.0)))
                val mods = item.optJSONArray("modificadores")
                if (mods != null) for (m in 0 until mods.length()) b.subRow(mods.optString(m))
            }
        }
        b.separator()

        b.leftRight("Subtotal", dinero(t.optDouble("subtotal", 0.0)))
        val descuento = t.optDouble("descuento", 0.0)
        if (descuento > 0.005) b.leftRight("Descuento", "-" + dinero(descuento))
        val impuestos = t.optDouble("impuestos", 0.0)
        if (impuestos > 0.005) b.leftRight(t.texto("etiquetaImpuestos") ?: "IVA", dinero(impuestos))

        // TOTAL en negrita y doble tamaño: a doble ancho caben la mitad de columnas.
        b.feed(1).setBold(true).setSize(doubleWidth = true, doubleHeight = true)
        b.leftRight("TOTAL", dinero(t.optDouble("total", 0.0)), columnas / 2)
        b.setSize(doubleWidth = false, doubleHeight = false).setBold(false)

        val pagos = t.optJSONArray("pagos")
        if (pagos != null && pagos.length() > 0) {
            for (i in 0 until pagos.length()) {
                val p = pagos.getJSONObject(i)
                b.leftRight(p.optString("metodo"), dinero(p.optDouble("monto", 0.0)))
            }
            val cambio = t.optDouble("cambio", 0.0)
            if (cambio > 0.005) b.leftRight("Cambio", dinero(cambio))
        }

        b.feed(1).setAlign(Align.CENTER)
        t.texto("pieTicket")?.let { pie -> pie.lines().forEach { b.line(it) } }

        t.texto("qrTexto")?.let {
            b.feed(1)
            t.texto("qrLeyenda")?.let { leyenda -> b.line(leyenda) }
            b.qrCode(it, moduleSize = if (columnas == 32) 5 else 7)
        }

        // Folio en CODE128: permite escanearlo después para buscar o reimprimir la venta.
        b.feed(1).barcode128(t.optInt("folio").toString(), height = 60, moduleWidth = 2)

        cerrar(b)
        return b.build()
    }

    /** Hoja de diagnóstico: acentos, anchos, estilos, QR, código de barras y corte. */
    fun paginaPrueba(): ByteArray {
        val b = nuevo()
        logo(b)
        b.setAlign(Align.CENTER).setBold(true).setSize(true, true).line("PRUEBA").setSize(false, false)
        b.line("Impresora USB - HANGAR 421").setBold(false)
        b.separator('=')
        b.setAlign(Align.LEFT)
        b.line("Codigo de pagina: ESC t ${cfg.codePage}")
        b.line("Columnas: $columnas  (${if (columnas == 32) "58" else "80"} mm)")
        b.line("Acentos: áéíóú ÁÉÍÓÚ ñÑ ü ¡Hola! ¿Qué tal?")
        b.line("Regla:")
        b.line((1..columnas).joinToString("") { (it % 10).toString() })
        b.separator()
        b.setBold(true).rowHeader().setBold(false)
        b.row("2", "Café americano grande", dinero(90.0))
        b.subRow("Leche de avena")
        b.row("1", "Sándwich de pechuga de pavo con queso panela y aguacate", dinero(135.5))
        b.separator()
        b.leftRight("Subtotal", dinero(225.5))
        b.setBold(true).setSize(true, true).leftRight("TOTAL", dinero(225.5), columnas / 2).setSize(false, false).setBold(false)
        b.feed(1).setAlign(Align.CENTER).line("QR:")
        b.qrCode("HANGAR 421 - PRUEBA DE IMPRESION", moduleSize = if (columnas == 32) 5 else 7)
        b.feed(1).line("CODE128:")
        b.barcode128("123456", height = 60)
        cerrar(b)
        return b.build()
    }

    private fun encabezado(b: TicketBuilder, t: JSONObject) {
        logo(b)
        b.setAlign(Align.CENTER)
        t.texto("razonSocial")?.let { b.setBold(true).setSize(false, true).line(it).setSize(false, false).setBold(false) }
        t.texto("nombreSucursal")?.let { b.line(it) }
        t.texto("direccion")?.let { dir -> dir.lines().forEach { b.line(it) } }
        t.texto("rfc")?.let { b.line("RFC: $it") }
        b.separator()
    }

    private fun logo(b: TicketBuilder) {
        if (!cfg.imprimirLogo) return
        val opts = BitmapFactory.Options().apply { inScaled = false }
        val bmp = runCatching { BitmapFactory.decodeResource(context.resources, R.drawable.logo_ticket, opts) }.getOrNull() ?: return
        b.setAlign(Align.CENTER).image(bmp, maxWidth = minOf(puntos, if (columnas == 32) 320 else 384)).feed(1)
        bmp.recycle()
    }

    private fun cerrar(b: TicketBuilder) {
        if (cfg.abrirCajon) b.openCashDrawer()
        if (cfg.cortarPapel) b.cutPaper() else b.feed(4)
    }

    private fun JSONObject.texto(clave: String): String? =
        if (isNull(clave)) null else optString(clave).trim().takeIf { it.isNotEmpty() }

    companion object {
        fun dinero(v: Double): String = (if (v < 0) "-" else "") + "$" + String.format(Locale.US, "%,.2f", abs(v))

        fun cantidad(v: Double): String =
            if (abs(v - Math.rint(v)) < 0.0001) Math.rint(v).toLong().toString() else String.format(Locale.US, "%.2f", v)
    }
}
