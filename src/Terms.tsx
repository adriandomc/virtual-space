import { t, useLocale } from './i18n';
import { ArrowLeft } from 'lucide-react';
import Brand from './Brand';
import { TERMS_VERSION } from './legalPolicy';
import LanguageSelector from './LanguageSelector';
import './information.css';
import './privacy.css';

export default function Terms() {
  useLocale();
  return <div className="privacy-page">
    <header className="privacy-header"><a href="/" aria-label={t("3D Space, inicio")}><Brand className="privacy-brand" /></a><LanguageSelector /><a className="privacy-back" href="/"><ArrowLeft size={18} />{t("Volver al inicio")}</a></header>
    <main className="privacy-main">
      <article className="privacy-document">
        <header><h1>{t("Condiciones de uso")}</h1><p className="privacy-updated">{t("Última actualización: 16 de octubre de 2026 · Versión")} {TERMS_VERSION}</p></header>
        <p className="privacy-summary">{t("3D Space es un servicio gratuito para crear y probar diseños de habitaciones. No tiene pagos, suscripciones, publicidad ni analíticas de uso.")}</p>
        <nav className="privacy-index" aria-label={t("Secciones de las condiciones")}><a href="#servicio">{t("Servicio")}</a><a href="#conservacion">{t("Conservación")}</a><a href="#respaldos">{t("Respaldos")}</a><a href="#contacto">{t("Contacto")}</a></nav>

        <section id="servicio"><h2>{t("Uso y gratuidad")}</h2>
          <p>{t("El servicio de 3D Space ofrecido por Adrián Domínguez Casasola será siempre gratuito mientras esté disponible. Puedes crear tu cuenta y utilizar el editor sin proporcionar datos de pago. La gratuidad no supone un compromiso de mantener el servicio abierto indefinidamente.")}</p>
          <p>{t("Al crear una cuenta, aceptas estas condiciones mediante la casilla del registro. Se conserva la versión aceptada y la fecha de aceptación. La cuenta sólo requiere un usuario y una contraseña; no se solicita correo electrónico.")}</p>
          <p>{t("Las medidas, colores, materiales e iluminación son representaciones orientativas. Los diseños no sustituyen planos certificados, mediciones, asesoría profesional ni comprobaciones de seguridad para una construcción o remodelación.")}</p>
        </section>

        <section><h2>{t("Tu cuenta y tus diseños")}</h2>
          <p>{t("Cada cuenta admite 50 diseños y 500 MiB de contenido. La biblioteca de modelos admite hasta 100 modelos y 100 MiB dentro de ese total. Si alcanzas un límite, puedes abrir, exportar o eliminar contenido para liberar espacio; tus cambios locales pendientes se conservan.")}</p>
          <p>{t("Eres responsable de mantener tu contraseña en secreto y de usar contenido que tengas derecho a incorporar. No hay recuperación de contraseñas: evita perderla y conserva copias de los diseños que necesites.")}</p>
          <p>{t("Tus diseños siguen siendo tuyos. Su almacenamiento y tratamiento se limitan a prestar el servicio, mantener su seguridad y atender las obligaciones descritas en el")} <a href="/privacy">{t("aviso de privacidad")}</a>{t(". No se venden, ni se utilizan para publicidad o entrenamiento de modelos de inteligencia artificial.")}</p>
          <p>{t("Los diseños son privados por defecto. Al activar un enlace compartido permites que quien lo reciba consulte ese diseño, su croquis y los modelos que incorpora y los descargue. Desactivar el enlace evita nuevas consultas, pero no elimina copias que otra persona ya haya descargado.")}</p>
          <p>{t("El propietario puede invitar a usuarios existentes como lectores o editores, cambiar sus roles o retirar su acceso. Los lectores consultan; los editores pueden modificar el diseño y añadir modelos. Cada persona invitada debe aceptar el acceso desde sus notificaciones. Sólo el propietario puede eliminar el diseño y administrar sus accesos.")}</p>
          <p>{t("Al aportar modificaciones o modelos a un diseño de otra persona, autorizas su uso dentro de ese diseño. Retirar tu acceso o eliminar tu cuenta no borra aportaciones ya integradas: el propietario puede conservarlas. Sólo sube modelos, imágenes y texturas que tengas derecho a utilizar y compartir. El taller guarda elementos nuevos sin modificar el archivo original.")}</p>
          <p>{t("No está permitido intentar acceder a cuentas ajenas, evadir los controles de seguridad, sobrecargar el servicio deliberadamente ni subir contenido ilícito o que vulnere derechos de otras personas. El acceso puede limitarse de forma proporcionada para detener un abuso o cumplir una obligación legal.")}</p>
        </section>

        <section id="conservacion"><h2>{t("Inactividad y eliminación")}</h2>
          <p>{t("Una cuenta sin actividad se conserva durante al menos")} <strong>{t("3 meses naturales")}</strong> {t("desde su última actividad autenticada correcta. Entrar a tu cuenta o usarla para consultar o editar tus diseños renueva ese plazo. Visitar el demo, intentar ingresar sin éxito o abrir un enlace compartido sin usar tu cuenta no lo renueva.")}</p>
          <p>{t("Al cumplirse ese plazo, la siguiente limpieza elimina automáticamente la cuenta, sus diseños, croquis, sesiones y enlaces compartidos. La limpieza se ejecuta cada hora mientras el servicio está funcionando; si se interrumpe, vuelve a comprobar las cuentas al arrancar. No se envían recordatorios por correo.")}</p>
          <p>{t("También se eliminan los modelos, permisos y estado de sincronización de sus diseños, así como sus invitaciones y accesos en otros diseños. La actividad de los colaboradores no renueva el plazo de la cuenta propietaria; si ésta vence, desaparecen sus diseños compartidos. Las aportaciones ya integradas en diseños de otros propietarios pueden permanecer en ellos.")}</p>
          <p>{t("Puedes eliminar tus diseños desde la aplicación o solicitar la cancelación de tu cuenta mediante el contacto indicado abajo. Las eliminaciones son definitivas para el uso del servicio. Los respaldos pueden conservar copias residuales durante el plazo explicado a continuación.")}</p>
        </section>

        <section><h2>{t("Uso sin conexión")}</h2>
          <p>{t("Puedes preparar la aplicación en tu dispositivo desde Ajustes. Se descargan tus diseños privados sin colaboradores ni enlace público, sus croquis y modelos y tu biblioteca de modelos. El modo sin conexión permite crear y editar diseños y modelos sin consultar ni enviar datos del servicio, aunque tengas internet. Recuperar la conexión no lo desactiva.")}</p>
          <p>{t("No hay colaboración en vivo en esa modalidad. Puedes preparar una copia personal de un diseño compartido mientras estés conectado; esa copia es independiente del original y de sus permisos.")}</p>
          <p>{t("Al desactivar el modo sin conexión se intentan sincronizar todos los cambios pendientes de la cuenta, previa comprobación de la sesión, el acceso y la versión del servidor. Un conflicto no autoriza sobrescribir automáticamente otra versión. Si vence la sesión, puedes continuar con el trabajo local y exportarlo; para sincronizar debes autenticarte de nuevo con la misma cuenta.")}</p>
          <p>{t("El almacenamiento local depende de tu navegador y no está cifrado por una contraseña propia de la aplicación. No es una copia de seguridad garantizada: borrar los datos del sitio o perder el dispositivo puede eliminar cambios sin sincronizar. El cierre de sesión comprueba los pendientes antes de permitir la limpieza de esa cuenta; conserva una exportación completa antes de descartarlos.")}</p>
          <p>{t("El uso sin conexión no renueva los tres meses de actividad de tu cuenta en el servidor. La cancelación o eliminación de la cuenta no puede borrar copias que permanezcan en dispositivos desconectados ni archivos exportados por sus usuarios.")}</p>
        </section>

        <section id="respaldos"><h2>{t("Respaldos")}</h2>
          <p>{t("Se realiza un respaldo diario de la base de datos, que incluye cuentas, diseños, croquis, modelos, invitaciones, permisos y estado de sincronización. Cada respaldo se comprueba restaurándolo en una copia temporal independiente antes de considerarlo válido.")}</p>
          <p>{t("Los respaldos se conservan durante 7 días y se eliminan en la siguiente limpieza horaria. Una interrupción del servicio puede retrasar la limpieza hasta su siguiente arranque. La información que elimines deja de estar disponible en la aplicación, aunque puede permanecer en estas copias hasta su eliminación.")}</p>
          <p>{t("Las copias se guardan con acceso restringido en el mismo servidor contratado con IONOS en Estados Unidos. No protegen frente a la pérdida total de ese servidor o su disco. Los respaldos reducen el riesgo de pérdida, pero no garantizan la recuperación de todos los cambios; conserva tus propias exportaciones.")}</p>
          <p>{t("Una restauración debe respetar las eliminaciones, las revocaciones de enlaces y accesos y los plazos de inactividad: las cuentas, contenidos y permisos eliminados no se vuelven a habilitar por recuperar una copia anterior. Tras restaurar se revocan las sesiones recuperadas y es necesario volver a iniciar sesión.")}</p>
        </section>

        <section><h2>{t("Disponibilidad y cierre")}</h2>
          <p>{t("El servicio se proporciona «tal cual», sin garantía de funcionamiento ininterrumpido, conservación indefinida o recuperación completa ante un fallo. No incluye soporte individual ni un plazo de respuesta para consultas generales. Puede haber interrupciones por mantenimiento, fallos técnicos o situaciones fuera del control del responsable.")}</p>
          <p>{t("Si el servicio cierra definitivamente, se eliminan las cuentas, diseños, croquis, sesiones, registros de eliminación y respaldos de la aplicación. Cuando sea posible, se publicará un aviso previo en el sitio para que puedas exportar tus diseños. No se garantiza un aviso previo cuando el cierre sea consecuencia de un fallo o una emergencia.")}</p>
          <p>{t("Estas condiciones no excluyen las obligaciones de protección de datos ni otros derechos que la ley no permita limitar. Las solicitudes de privacidad se atienden conforme a los plazos legales aplicables.")}</p>
        </section>

        <section><h2>{t("Seguridad y privacidad")}</h2>
          <p>{t("La contraseña original no se guarda: se conserva una derivación mediante scrypt y una sal aleatoria. Esto permite comprobarla sin almacenar una copia reversible. Se aplican controles de acceso y límites contra intentos abusivos; ninguna medida permite prometer que nunca ocurrirá un incidente.")}</p>
          <p>{t("La información no está cifrada de extremo a extremo. La administración del servidor puede acceder a los datos cuando sea necesario para operar y proteger el servicio, con deber de confidencialidad. El")} <a href="/privacy">{t("aviso de privacidad")}</a> {t("explica qué datos se utilizan, su conservación, las cookies y tus opciones.")}</p>
        </section>

        <section><h2>{t("Cambios en las condiciones")}</h2>
          <p>{t("La versión vigente se publica en esta dirección con su fecha. Los cambios que afecten de forma sustancial a la conservación o al uso de tus datos se comunicarán antes de aplicarse. Si requieren una nueva aceptación o autorización, se solicitará antes de hacer efectivo ese cambio.")}</p>
        </section>

        <section id="contacto"><h2>{t("Responsable y contacto")}</h2>
          <p>{t("El responsable es Adrián Domínguez Casasola. Puedes contactar en")} <a href="mailto:adriandomc@gmail.com?subject=3D%20Space">{t("adriandomc@gmail.com")}</a>{t(". El domicilio para notificaciones y el procedimiento para ejercer tus derechos están en el")} <a href="/privacy#contacto">{t("aviso de privacidad")}</a>.</p>
        </section>
        <footer className="privacy-references"><a href="/privacy">{t("Aviso de privacidad")}</a><a href="/login">{t("Entrar o crear cuenta")}</a></footer>
      </article>
    </main>
  </div>;
}
