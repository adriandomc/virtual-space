import { t, useLocale } from './i18n';
import { ArrowLeft } from 'lucide-react';
import Brand from './Brand';
import LanguageSelector from './LanguageSelector';
import './information.css';
import './privacy.css';

const details = {
  responsible: 'Adrián Domínguez Casasola',
  address: 'Mozoyuca s/n, esquina San Antonio, La Palma, Tecámac',
  email: 'adriandomc@gmail.com',
  serverCountry: 'Estados Unidos',
  backups: 'Se realiza un respaldo diario de la base de datos y se verifica restaurándolo en una copia temporal independiente. Las copias se conservan durante 7 días y se eliminan en la siguiente limpieza horaria; una interrupción del servicio puede retrasar esa limpieza hasta su siguiente arranque. Los respaldos se guardan con acceso restringido en el mismo servidor de IONOS en Estados Unidos. No son copias externas y no protegen frente a la pérdida total del servidor o su disco. Al eliminar información, deja de estar disponible en la aplicación, pero puede permanecer en estas copias hasta que se eliminen. Las restauraciones deben respetar las eliminaciones realizadas y los plazos de inactividad.',
  accessLogs: 'El proxy Caddy no mantiene un registro HTTP de cada visita. La aplicación y el proxy pueden conservar diagnósticos de errores, incluida información técnica de conexión cuando resulte necesaria para resolver un fallo. Estos logs se almacenan localmente con rotación de hasta tres archivos de 10 MB por contenedor: se reemplazan según su volumen, sin un plazo fijo de días. No hay envío externo de logs activado en Coolify para este servicio.',
};
const complete = Object.values(details).every(value => value.trim());

export default function Privacy() {
  useLocale();
  return <div className="privacy-page">
    <header className="privacy-header"><a href="/" aria-label={t("3D Space, inicio")}><Brand className="privacy-brand" /></a><LanguageSelector /><a className="privacy-back" href="/"><ArrowLeft size={18} />{t("Volver al inicio")}</a></header>
    <main className="privacy-main">
      <article className="privacy-document">
        <header><h1>{t("Aviso de privacidad")}</h1><p className="privacy-updated">{t("Última actualización: 15 de octubre de 2026")}</p></header>
        {!complete && <p className="privacy-draft" role="status">{t("Aviso en preparación: falta confirmar los datos del responsable y la configuración del servidor.")}</p>}
        <p className="privacy-summary">{t("3D Space no incorpora analíticas de uso, publicidad ni rastreadores. Los diseños son privados por defecto y sólo se muestran a otras personas cuando decides compartirlos.")}</p>
        <nav className="privacy-index" aria-label={t("Secciones del aviso")}><a href="#datos">{t("Datos")}</a><a href="#cookies">{t("Cookies")}</a><a href="#opciones">{t("Tus opciones")}</a><a href="#contacto">{t("Contacto")}</a></nav>

        <section id="contacto"><h2>{t("Responsable y contacto")}</h2><dl className="privacy-details">
          <div><dt>{t("Responsable de 3D Space")}</dt><dd>{details.responsible || t('Pendiente de confirmar')}</dd></div>
          <div><dt>{t("Domicilio para notificaciones")}</dt><dd>{details.address || t('Pendiente de confirmar')}</dd></div>
          <div><dt>{t("Contacto de privacidad")}</dt><dd>{details.email ? <a href={'mailto:' + details.email + '?subject=Privacidad%203D%20Space'}>{details.email}</a> : t('Pendiente de confirmar')}</dd></div>
          <div><dt>{t("Proveedor de alojamiento")}</dt><dd>{t("IONOS")}</dd></div>
          <div><dt>{t("País donde se aloja el servidor")}</dt><dd>{t(details.serverCountry || t('Pendiente de confirmar'))}</dd></div>
        </dl><p>{t("Las solicitudes enviadas a este correo se atienden a través de Gmail (Google).")}</p></section>

        <section id="datos"><h2>{t("Qué datos se utilizan")}</h2>
          <p>{t("Para crear una cuenta sólo se pide un usuario y una contraseña. No se solicita nombre real, correo, teléfono, domicilio ni información de pago. Puedes elegir un alias que no te identifique.")}</p>
          <ul>
            <li><strong>{t("Cuenta y acceso:")}</strong> {t("usuario, identificador de cuenta, fecha de creación, fecha de la última actividad autenticada correcta y una versión derivada de la contraseña mediante scrypt con una sal aleatoria. La contraseña original y su confirmación no se guardan. También se conservan identificadores protegidos de sesión y sus fechas. Al registrarte, se guarda la versión de las condiciones de uso que aceptaste y la fecha de aceptación.")}</li>
            <li><strong>{t("Diseños:")}</strong> {t("nombre, dimensiones, planta, colores, materiales, objetos, iluminación, ajustes y fechas de actualización. Los croquis se guardan como se suben, incluidos los metadatos que pueda contener el archivo.")}</li>
            <li><strong>{t("Colaboración:")}</strong> {t("usuario que invita, usuario invitado, diseño, rol de lector o editor, fecha y aceptación de la invitación. Las notificaciones muestran al destinatario el usuario que lo invita y el nombre del diseño. Se guarda el estado de sincronización necesario para combinar y recuperar los cambios del diseño.")}</li>
            <li><strong>{t("Modelos:")}</strong> {t("archivos GLB, nombres de piezas y materiales, texturas, metadatos y elementos nuevos creados en el taller. Los archivos originales se conservan con los metadatos que contengan; evita incorporar datos personales en ellos.")}</li>
            <li><strong>{t("Seguridad:")}</strong> {t("la dirección IP recibida se utiliza para limitar peticiones y frenar intentos de acceso abusivos. La aplicación guarda identificadores derivados de la IP, contadores y fechas de bloqueo; no la IP literal en su base de datos. Estos identificadores no garantizan anonimato.")}</li>
            <li><strong>{t("Eliminaciones y revocaciones:")}</strong> {t("se conserva por separado el identificador de la cuenta, elemento eliminado o enlace revocado y su fecha; para los croquis también se conserva su versión. No se incluyen contraseñas ni contenido. Este registro evita que una restauración vuelva a habilitar contenido eliminado o enlaces revocados.")}</li>
            <li><strong>{t("Solicitudes de privacidad:")}</strong> {t("si nos contactas, se utilizan tu mensaje, datos de contacto y la información mínima necesaria para atenderte y comprobar que la cuenta te pertenece.")}</li>
          </ul>
          <p>{t("No se pide información sensible. Evita incluir datos personales de otras personas, domicilios reales o documentos sensibles en nombres de diseños, croquis, modelos y texturas.")}</p>
          <p>{t("El tamaño de pantalla y la capacidad gráfica se consultan en tu navegador para adaptar el visor. No se envían como estadísticas de uso.")}</p>
        </section>

        <section><h2>{t("Para qué se utilizan")}</h2>
          <p>{t("Los datos se utilizan para permitir el acceso, guardar y recuperar tus diseños y modelos, gestionar las invitaciones y permisos, sincronizar los cambios entre colaboradores, realizar respaldos respetando las eliminaciones, aplicar el plazo de inactividad, acreditar la aceptación de las condiciones, atender tus solicitudes y mantener la seguridad del servicio. No se venden ni se utilizan para publicidad, perfiles de comportamiento, analíticas de uso o entrenamiento de modelos de inteligencia artificial.")}</p>
          <p>{t("La página de inicio utiliza un demo temporal. Los cambios que hagas en ese demo no se envían para guardarse en tu cuenta.")}</p>
        </section>

        <section><h2>{t("Quién puede acceder")}</h2>
          <p>{t("La aplicación restringe el acceso a tu cuenta y a tus diseños privados. Puedes invitar a usuarios existentes: los lectores pueden consultarlos y los editores modificarlos. El propietario decide a quién invitar, puede cambiar el rol y retirar el acceso. El responsable y las personas autorizadas para operar el servidor pueden acceder a los datos almacenados cuando sea necesario para mantener el servicio, atender solicitudes o resolver problemas de seguridad, con deber de confidencialidad.")}</p>
          <p>{t("Si activas un enlace compartido, cualquier persona que lo reciba puede ver ese diseño, su croquis y los modelos que incorpora, incluidos sus metadatos, y descargarlos. El enlace no muestra tu usuario ni concede permiso para editar. Puedes desactivarlo; esto impide nuevas consultas, pero no elimina copias que alguien ya haya descargado.")}</p>
          <p>{t("Las modificaciones y modelos que aportes a un diseño de otra persona pasan a formar parte de ese diseño. El propietario puede conservarlos aunque retires tu acceso o elimines tu cuenta. Eliminar tu cuenta retira tus credenciales, tus diseños propios y tus invitaciones y accesos, pero no borra las aportaciones ya integradas en diseños de otras personas.")}</p>
          <p>{t("No se ceden datos para fines comerciales. Los proveedores autorizados de alojamiento, respaldo o correo sólo intervienen cuando son necesarios para prestar el servicio o atenderte. También pueden comunicarse los datos que exija una obligación legal válida.")}</p>
          <p>{t("Para prestar el servicio, los datos de la aplicación se alojan en el servidor contratado con IONOS en Estados Unidos. El correo de contacto utiliza Gmail; las solicitudes que envíes por esa vía también son procesadas por su proveedor de correo.")}</p>
        </section>

        <section id="cookies"><h2>{t("Cookies")}</h2>
          <p>{t('El idioma elegido se guarda en este navegador para recordar tu preferencia. No se utiliza para analíticas ni se envía al servidor.')}</p>
          <p>{t("Al iniciar sesión o crear una cuenta se utiliza una cookie propia de autenticación, denominada")} <code>{t("__Host-vs_session")}</code>{t(". Permite reconocer tu sesión y acceder a tus diseños. No se crean cookies de analítica o publicidad, ni cookies de terceros desde la aplicación.")}</p>
          <dl className="privacy-details">
            <div><dt>{t("Acceso normal")}</dt><dd>{t("Cookie de sesión, sin una fecha de conservación permanente en el navegador. Su cierre depende del navegador, incluida la restauración de sesiones. El acceso deja de ser válido como máximo a los 30 días.")}</dd></div>
            <div><dt>{t("Recordar sesión")}</dt><dd>{t("Si marcas la opción «Recordar sesión 30 días (usa cookies)», autorizas conservar esa cookie durante un máximo de 30 días desde el acceso. La casilla está desmarcada por defecto y no es necesaria para usar el sitio.")}</dd></div>
            <div><dt>{t("Retirar la elección")}</dt><dd>{t("Cierra sesión para eliminar la cookie y revocar ese acceso. Puedes volver a entrar sin marcar «Recordar sesión». También puedes borrar las cookies desde el navegador; borrarlas impide mantener el acceso a tu cuenta.")}</dd></div>
          </dl>
          <p>{t("La cookie está protegida para que el código de la página no pueda leerla y se transmite por conexiones seguras en producción. Una elección nueva sobre recordar el acceso se aplica al volver a iniciar sesión.")}</p>
          <p>{t("Desde Ajustes puedes preparar el uso sin conexión en este dispositivo. Se guardan los recursos de la aplicación, tus diseños privados sin colaboradores ni enlace público, sus croquis y modelos y tu biblioteca de modelos. Puedes instalar la aplicación cuando tu navegador lo permita. La instalación y estas copias no constituyen un respaldo externo.")}</p>
          <p>{t("El modo sin conexión permite crear y modificar diseños y modelos sin enviar ni consultar datos del servicio, incluso cuando el dispositivo tenga internet. La elección se conserva para esa cuenta y ese navegador. No permite colaboración en vivo: para trabajar con un diseño compartido puedes preparar una copia personal independiente mientras tengas conexión, sin cambiar el original ni sus permisos.")}</p>
          <p>{t("Los datos locales se separan por cuenta y no contienen contraseñas ni claves de sesión. Puedes seguir usando y exportando el trabajo local si vence la sesión, pero para sincronizar debes volver a entrar en la misma cuenta. Al desactivar el modo sin conexión, se comprueban la sesión, los permisos y las versiones antes de enviar todos los cambios pendientes, incluidos diseños que no estén abiertos. Si hay un conflicto o se retiró el acceso, el borrador se conserva para recuperarlo sin sobrescribir el servidor.")}</p>
          <p>{t("El cierre de sesión requiere conexión y comprueba si quedan cambios locales pendientes antes de limpiar los datos de esa cuenta. Puedes sincronizarlos o descargar una copia completa antes de descartarlos expresamente. Los datos de otras cuentas no se eliminan por cerrar esa sesión. Un dispositivo compartido puede conservar trabajo local: utiliza un perfil de navegador propio y cierra la sesión cuando hayas guardado tus cambios.")}</p>
          <p>{t("El trabajo local no renueva el plazo de inactividad de la cuenta en el servidor. El navegador puede limitar o borrar su almacenamiento; también puedes borrar los datos del sitio desde sus ajustes. Esto puede eliminar cambios que todavía no se hayan sincronizado. La eliminación del contenido del servidor no puede borrar un dispositivo que permanece desconectado ni las copias descargadas por tu cuenta.")}</p>
          <p>{t("No se muestra un banner para aceptar cookies opcionales durante la visita: la única elección adicional es recordar la sesión y se realiza en el formulario de acceso. Si se añaden cookies para otras finalidades, se informará y se solicitará la elección que corresponda antes de utilizarlas.")}</p>
        </section>

        <section><h2>{t("Conservación y seguridad")}</h2>
          <p>{t("La cuenta y sus diseños se conservan mientras la utilices, hasta que elimines el contenido o solicites su cancelación. Una cuenta sin actividad se mantiene durante al menos 3 meses naturales desde su última actividad autenticada correcta. Una entrada o uso correcto de tu cuenta renueva el plazo; visitar un enlace compartido sin utilizarla o un intento fallido de acceso no lo renueva.")}</p>
          <p>{t("Al cumplirse los 3 meses, la siguiente limpieza elimina automáticamente la cuenta, sus diseños, croquis, sesiones y enlaces compartidos. La limpieza se ejecuta cada hora mientras el servicio funciona y vuelve a comprobar los plazos al arrancar tras una interrupción.")}</p>
          <p>{t("La eliminación también retira los modelos, permisos y estado de sincronización de sus diseños y sus invitaciones y accesos en otros diseños. La actividad de los invitados renueva su propia cuenta, pero no el plazo de la cuenta propietaria: si ésta vence, sus diseños compartidos también se eliminan.")}</p>
          <p>{t("Las sesiones dejan de ser válidas al cerrar sesión o al caducar, y sus registros vencidos se depuran en la siguiente limpieza de la aplicación.")}</p>
          <p>{t("Los contadores de seguridad sin actividad durante más de 48 horas y sin un bloqueo vigente se eliminan en la siguiente limpieza de la aplicación. No son un historial de navegación.")}</p>
          <p>{t("La aplicación registra mensajes de arranque y errores técnicos para detectar fallos. No incorpora un historial de navegación o edición de diseños. El registro separado de eliminaciones se conserva durante 7 días y hasta la siguiente limpieza horaria, para respetar los borrados al restaurar un respaldo. Si el servicio se interrumpe, la limpieza se reanuda al arrancar.")}</p>
          <p>{t(details.accessLogs || 'La configuración de los registros de acceso del servidor está pendiente de confirmar.')}</p>
          <p>{t("La infraestructura supervisa el estado del servidor, como uso de CPU, memoria, disco y red, para mantener el servicio disponible. El historial de esas métricas se conserva durante siete días en el propio servidor. Esta supervisión no es un historial de visitas ni del contenido de tus diseños.")}</p>
          <p>{t(details.backups || 'La configuración y el plazo de conservación de los respaldos están pendientes de confirmar.')}</p>
          <p>{t("Tras restaurar un respaldo, se revocan las sesiones recuperadas y es necesario volver a iniciar sesión.")}</p>
          <p>{t("Si el servicio cierra definitivamente, se eliminan las cuentas, diseños, croquis, sesiones, registros de eliminación y respaldos de la aplicación. La eliminación retira los datos de su uso en el servicio; no implica garantizar el borrado físico inmediato de cada sector del disco o de una copia que alguien haya descargado.")}</p>
          <p>{t("Se utilizan controles de acceso, contraseñas derivadas con sal aleatoria, sesiones protegidas y límites contra accesos abusivos. La información guardada no está cifrada de extremo a extremo: la administración del servidor puede acceder a ella. Ningún sistema permite garantizar un riesgo de seguridad nulo.")}</p>
        </section>

        <section id="opciones"><h2>{t("Tus opciones y derechos")}</h2>
          <p>{t("Puedes consultar y modificar tus diseños, descargar una copia con su croquis y modelos, eliminar diseños, croquis o modelos que ya no se utilicen, activar o revocar los enlaces compartidos e invitar, cambiar roles o retirar el acceso de colaboradores desde tu cuenta. En los diseños de otras personas sólo puedes realizar las acciones que permita tu rol.")}</p>
          <p>{t("Para solicitar acceso, rectificación, cancelación u oposición al tratamiento de tus datos, limitar su uso o revocar una autorización, utiliza el contacto de privacidad indicado arriba. Incluye tu usuario, lo que solicitas y un medio para recibir la respuesta. Se comprobará tu identidad de forma proporcional; no envíes tu contraseña.")}</p>
          <p>{t("Las solicitudes se atenderán dentro de los plazos legales aplicables. Si una obligación legal impide eliminar alguna información de inmediato, se explicará el motivo y se limitará su uso a esa obligación. El ejercicio de estos derechos es gratuito, salvo los costes de reproducción o envío permitidos por la ley.")}</p>
        </section>

        <section><h2>{t("Cambios en este aviso")}</h2>
          <p>{t("La versión vigente se publicará en esta misma dirección con su fecha de actualización. Los cambios en finalidades o en el uso de cookies que requieran una nueva elección se comunicarán antes de aplicarlos y se solicitará la autorización correspondiente.")}</p>
        </section>
        <footer className="privacy-references"><a href="/terms">{t("Condiciones de uso")}</a><a href="https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf" target="_blank" rel="noreferrer">{t("Ley de protección de datos personales de México")}</a><a href="https://www.aepd.es/guias/guia-cookies.pdf" target="_blank" rel="noreferrer">{t("Guía sobre el uso de cookies")}</a></footer>
      </article>
    </main>
  </div>;
}
