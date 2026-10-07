-- Método de pago "Pagado en línea": el cliente ya pagó en la app de la plataforma (DiDi Food…).
-- No entra al cajón; el corte lo muestra aparte dentro del origen DiDi.
ALTER TYPE "MetodoPago" ADD VALUE 'EN_LINEA';
