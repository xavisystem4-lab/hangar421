package expo.modules.hangarusbprinter

import android.graphics.Bitmap
import android.graphics.Color
import java.io.ByteArrayOutputStream
import java.nio.charset.Charset
import java.text.Normalizer

/**
 * Arma el flujo de bytes ESC/POS de un ticket. No sabe nada de USB: solo produce un ByteArray
 * que después se manda tal cual a la impresora (ver UsbPrinterManager).
 *
 * [codePage] es el número de `ESC t n` y debe corresponder con el [charset] con el que se
 * codifica el texto; si no, los acentos salen cambiados. La tabla que acepta cada impresora
 * viene en su página de autodiagnóstico (encenderla con FEED presionado).
 */
class TicketBuilder(
    private val codePage: Int = 16,
    val lineWidth: Int = 48,
    private val quitarAcentos: Boolean = false,
    private val charset: Charset = charsetPara(codePage),
) {
    private val stream = ByteArrayOutputStream()

    fun init() = apply {
        stream.write(byteArrayOf(ESC, 0x40))                         // ESC @  reinicia estilos
        stream.write(byteArrayOf(ESC, 0x74, codePage.toByte()))      // ESC t n código de página
    }

    fun setAlign(a: Align) = apply { stream.write(byteArrayOf(ESC, 0x61, a.value)) }

    fun setBold(on: Boolean) = apply { stream.write(byteArrayOf(ESC, 0x45, if (on) 1 else 0)) }

    /** GS ! n — bits 4-6 = ancho, bits 0-2 = alto. Doble ancho es 0x10 (0x20 sería triple). */
    fun setSize(doubleWidth: Boolean, doubleHeight: Boolean) = apply {
        val n = (if (doubleWidth) 0x10 else 0) or (if (doubleHeight) 0x01 else 0)
        stream.write(byteArrayOf(GS, 0x21, n.toByte()))
    }

    fun text(t: String) = apply { stream.write(preparar(t).toByteArray(charset)) }

    fun line(t: String = "") = text("$t\n")

    fun separator(c: Char = '-') = line(c.toString().repeat(lineWidth))

    /** ESC d n — avanza n líneas. */
    fun feed(n: Int = 1) = apply { stream.write(byteArrayOf(ESC, 0x64, n.coerceIn(0, 255).toByte())) }

    /** Una línea de producto: cantidad | descripción (se parte en varias líneas) | importe. */
    fun row(cant: String, desc: String, total: String) = apply {
        val dW = lineWidth - COL_CANT - COL_IMPORTE
        wrap(desc, dW).forEachIndexed { i, l ->
            if (i == 0) line(cant.take(COL_CANT - 1).padEnd(COL_CANT) + l.padEnd(dW) + total.takeLast(COL_IMPORTE).padStart(COL_IMPORTE))
            else line(" ".repeat(COL_CANT) + l)
        }
    }

    /** Encabezado de la tabla de productos, alineado con [row]. */
    fun rowHeader(cant: String = "CANT", desc: String = "DESCRIPCION", total: String = "IMPORTE") = apply {
        val dW = lineWidth - COL_CANT - COL_IMPORTE
        line(cant.padEnd(COL_CANT) + desc.take(dW).padEnd(dW) + total.padStart(COL_IMPORTE))
    }

    /** Línea sangrada bajo un producto (modificadores: "Grande", "Leche de avena"…). */
    fun subRow(t: String) = apply {
        wrap(t, lineWidth - COL_CANT - 2).forEach { line(" ".repeat(COL_CANT) + "+ " + it) }
    }

    /** "Subtotal                 $120.00". [width] se pasa a la mitad cuando el texto va a doble ancho. */
    fun leftRight(left: String, right: String, width: Int = lineWidth) = apply {
        if (right.length >= width) { line(right); return@apply }
        val espacio = width - right.length
        val izq = if (left.length >= espacio) left.take((espacio - 1).coerceAtLeast(0)) else left
        line(izq.padEnd(espacio) + right)
    }

    /**
     * GS v 0 — imagen raster. Se escala a [maxWidth] puntos (576 en 80 mm, 384 en 58 mm), los
     * píxeles transparentes cuentan como blanco (si no, un PNG con fondo transparente sale como un
     * bloque negro) y se manda en bandas de 128 filas para no desbordar el búfer de impresoras
     * económicas.
     */
    fun image(src: Bitmap, maxWidth: Int = 576) = apply {
        val bmp = if (src.width > maxWidth)
            Bitmap.createScaledBitmap(src, maxWidth, (src.height.toLong() * maxWidth / src.width).toInt().coerceAtLeast(1), true)
        else src
        val w = bmp.width
        val h = bmp.height
        val wb = (w + 7) / 8
        val px = IntArray(w * h).also { bmp.getPixels(it, 0, w, 0, 0, w, h) }
        var y0 = 0
        while (y0 < h) {
            val band = minOf(128, h - y0)
            stream.write(byteArrayOf(GS, 0x76, 0x30, 0x00,
                (wb and 0xFF).toByte(), (wb shr 8).toByte(), (band and 0xFF).toByte(), (band shr 8).toByte()))
            val data = ByteArray(wb * band)
            for (y in 0 until band) {
                for (x in 0 until w) {
                    val p = px[(y0 + y) * w + x]
                    val gris = (Color.red(p) * 299 + Color.green(p) * 587 + Color.blue(p) * 114) / 1000
                    if ((p ushr 24) >= 128 && gris < 128) {
                        val i = y * wb + x / 8
                        data[i] = (data[i].toInt() or (0x80 shr (x % 8))).toByte()
                    }
                }
            }
            stream.write(data)
            y0 += band
        }
        if (bmp !== src) bmp.recycle()
    }

    /** QR nativo (GS ( k), modelo 2, corrección M. */
    fun qrCode(data: String, moduleSize: Int = 7) = apply {
        val b = data.toByteArray(Charsets.UTF_8)
        val len = b.size + 3
        stream.write(byteArrayOf(GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00))                       // modelo 2
        stream.write(byteArrayOf(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, moduleSize.coerceIn(1, 16).toByte())) // tamaño de módulo
        stream.write(byteArrayOf(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31))                             // corrección M (49)
        stream.write(byteArrayOf(GS, 0x28, 0x6B, (len and 0xFF).toByte(), (len shr 8).toByte(), 0x31, 0x50, 0x30))
        stream.write(b)
        stream.write(byteArrayOf(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30))                             // imprimir
    }

    /** CODE128 juego B con el texto legible (HRI) debajo. Un "{" literal se escapa como "{{". */
    fun barcode128(data: String, height: Int = 80, moduleWidth: Int = 2) = apply {
        require(data.isNotEmpty() && data.all { it.code in 32..126 }) { "CODE128-B solo admite ASCII imprimible" }
        val body = ("{B" + data.replace("{", "{{")).toByteArray(Charsets.US_ASCII)
        require(body.size <= 255) { "Código de barras demasiado largo" }
        stream.write(byteArrayOf(GS, 0x68, height.coerceIn(1, 255).toByte()))      // GS h alto
        stream.write(byteArrayOf(GS, 0x77, moduleWidth.coerceIn(2, 6).toByte()))    // GS w ancho de barra
        stream.write(byteArrayOf(GS, 0x48, 0x02))                                   // GS H texto abajo
        stream.write(byteArrayOf(GS, 0x6B, 73, body.size.toByte()))
        stream.write(body)
    }

    /** ESC p — pulso al conector RJ11 del cajón de dinero (pin 2). */
    fun openCashDrawer() = apply { stream.write(byteArrayOf(ESC, 0x70, 0x00, 0x19, 0xFA.toByte())) }

    /** Avanza para que lo último impreso pase la cuchilla y hace corte parcial (GS V 66 0). */
    fun cutPaper(feedLines: Int = 4) = apply {
        feed(feedLines)
        stream.write(byteArrayOf(GS, 0x56, 0x42, 0x00))
    }

    fun build(): ByteArray = stream.toByteArray()

    private fun preparar(t: String): String {
        if (!quitarAcentos) return t
        return Normalizer.normalize(t, Normalizer.Form.NFD)
            .replace(MARCAS, "")
            .replace('¡', '!')
            .replace('¿', '?')
    }

    private fun wrap(s: String, w: Int): List<String> {
        if (w <= 0) return listOf(s)
        val out = mutableListOf<String>()
        var cur = ""
        for (palabra in s.trim().split(Regex("\\s+"))) {
            var p = palabra
            while (p.length > w) {
                if (cur.isNotEmpty()) { out += cur; cur = "" }
                out += p.take(w)
                p = p.drop(w)
            }
            cur = when {
                cur.isEmpty() -> p
                cur.length + 1 + p.length <= w -> "$cur $p"
                else -> { out += cur; p }
            }
        }
        if (cur.isNotEmpty() || out.isEmpty()) out += cur
        return out
    }

    enum class Align(val value: Byte) { LEFT(0), CENTER(1), RIGHT(2) }

    companion object {
        private const val ESC: Byte = 0x1B
        private const val GS: Byte = 0x1D
        private const val COL_CANT = 5
        private const val COL_IMPORTE = 11
        private val MARCAS = Regex("\\p{Mn}+")

        /** `ESC t n` → charset de Java equivalente. 16 = WPC1252 (default), 2 = PC850, 0 = PC437. */
        fun charsetPara(codePage: Int): Charset = runCatching {
            Charset.forName(
                when (codePage) {
                    0 -> "IBM437"
                    2 -> "IBM850"
                    19 -> "IBM00858"
                    else -> "windows-1252"
                }
            )
        }.getOrDefault(Charsets.ISO_8859_1)
    }
}
