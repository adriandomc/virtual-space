import { ArrowLeft } from 'lucide-react';
import Brand from './Brand';
import './privacy.css';

const details = {
  responsible: 'Adrián Domínguez Casasola',
  address: 'Mozoyuca s/n, esquina San Antonio, La Palma, Tecámac',
  email: 'adriandomc@gmail.com',
  serverCountry: 'Estados Unidos',
  backups: 'No se han activado respaldos específicos de 3D Space por parte del responsable. Eliminar un diseño lo retira de las consultas de la aplicación. Si se activan respaldos, este aviso informará cómo se conservan y eliminan.',
  accessLogs: 'El proxy Caddy no mantiene un registro HTTP de cada visita. La aplicación y el proxy pueden conservar diagnósticos de errores, incluida información técnica de conexión cuando resulte necesaria para resolver un fallo. Estos logs se almacenan localmente con rotación de hasta tres archivos de 10 MB por contenedor: se reemplazan según su volumen, sin un plazo fijo de días. No hay envío externo de logs activado en Coolify para este servicio.',
};
const complete = Object.values(details).every(value => value.trim());

export default function Privacy() {
  return <div className="privacy-page">
    <header className="privacy-header"><a href="/" aria-label="3D Space, inicio"><Brand className="privacy-brand" /></a><a className="privacy-back" href="/"><ArrowLeft size={18} />Volver al inicio</a></header>
    <main className="privacy-main">
      <article className="privacy-document">
        <header><h1>Aviso de privacidad</h1><p className="privacy-updated">Última actualización: 13 de octubre de 2026</p></header>
        {!complete && <p className="privacy-draft" role="status">Aviso en preparación: falta confirmar los datos del responsable y la configuración del servidor.</p>}
        <p className="privacy-summary">3D Space no incorpora analíticas de uso, publicidad ni rastreadores. Los diseños son privados por defecto y sólo se muestran a otras personas cuando decides compartirlos.</p>
        <nav className="privacy-index" aria-label="Secciones del aviso"><a href="#datos">Datos</a><a href="#cookies">Cookies</a><a href="#opciones">Tus opciones</a><a href="#contacto">Contacto</a></nav>

        <section id="contacto"><h2>Responsable y contacto</h2><dl className="privacy-details">
          <div><dt>Responsable de 3D Space</dt><dd>{details.responsible || 'Pendiente de confirmar'}</dd></div>
          <div><dt>Domicilio para notificaciones</dt><dd>{details.address || 'Pendiente de confirmar'}</dd></div>
          <div><dt>Contacto de privacidad</dt><dd>{details.email ? <a href={'mailto:' + details.email + '?subject=Privacidad%203D%20Space'}>{details.email}</a> : 'Pendiente de confirmar'}</dd></div>
          <div><dt>Proveedor de alojamiento</dt><dd>IONOS</dd></div>
          <div><dt>País donde se aloja el servidor</dt><dd>{details.serverCountry || 'Pendiente de confirmar'}</dd></div>
        </dl><p>Las solicitudes enviadas a este correo se atienden a través de Gmail (Google).</p></section>

        <section id="datos"><h2>Qué datos se utilizan</h2>
          <p>Para crear una cuenta sólo se pide un usuario y una contraseña. No se solicita nombre real, correo, teléfono, domicilio ni información de pago. Puedes elegir un alias que no te identifique.</p>
          <ul>
            <li><strong>Cuenta y acceso:</strong> usuario, identificador de cuenta, fecha de creación y una versión derivada de la contraseña con una sal aleatoria. La contraseña original y su confirmación no se guardan. También se conservan identificadores protegidos de sesión y sus fechas.</li>
            <li><strong>Diseños:</strong> nombre, dimensiones, planta, colores, materiales, objetos, iluminación, ajustes y fechas de actualización. Los croquis se guardan como se suben, incluidos los metadatos que pueda contener el archivo.</li>
            <li><strong>Seguridad:</strong> la dirección IP recibida se utiliza para limitar peticiones y frenar intentos de acceso abusivos. La aplicación guarda identificadores derivados de la IP, contadores y fechas de bloqueo; no la IP literal en su base de datos. Estos identificadores no garantizan anonimato.</li>
            <li><strong>Solicitudes de privacidad:</strong> si nos contactas, se utilizan tu mensaje, datos de contacto y la información mínima necesaria para atenderte y comprobar que la cuenta te pertenece.</li>
          </ul>
          <p>No se pide información sensible. Evita incluir datos personales de otras personas, domicilios reales o documentos sensibles en nombres de diseños o croquis.</p>
          <p>El tamaño de pantalla y la capacidad gráfica se consultan en tu navegador para adaptar el visor. No se envían como estadísticas de uso.</p>
        </section>

        <section><h2>Para qué se utilizan</h2>
          <p>Los datos se utilizan para permitir el acceso, guardar y recuperar tus diseños, atender tus solicitudes y mantener la seguridad del servicio. No se venden ni se utilizan para publicidad, perfiles de comportamiento, analíticas de uso o entrenamiento de modelos de inteligencia artificial.</p>
          <p>La página de inicio utiliza un demo temporal. Los cambios que hagas en ese demo no se envían para guardarse en tu cuenta.</p>
        </section>

        <section><h2>Quién puede acceder</h2>
          <p>La aplicación restringe el acceso a tu cuenta y a tus diseños privados. Otros usuarios no pueden consultarlos ni editarlos. El responsable y las personas autorizadas para operar el servidor pueden acceder a los datos almacenados cuando sea necesario para mantener el servicio, atender solicitudes o resolver problemas de seguridad, con deber de confidencialidad.</p>
          <p>Si activas un enlace compartido, cualquier persona que lo reciba puede ver ese diseño y su croquis, incluidos los metadatos del archivo. El enlace no muestra tu usuario ni concede permiso para editar. Puedes desactivarlo; esto impide nuevas consultas, pero no elimina copias que alguien ya haya descargado.</p>
          <p>No se ceden datos para fines comerciales. Los proveedores autorizados de alojamiento, respaldo o correo sólo intervienen cuando son necesarios para prestar el servicio o atenderte. También pueden comunicarse los datos que exija una obligación legal válida.</p>
          <p>Para prestar el servicio, los datos de la aplicación se alojan en el servidor contratado con IONOS en Estados Unidos. El correo de contacto utiliza Gmail; las solicitudes que envíes por esa vía también son procesadas por su proveedor de correo.</p>
        </section>

        <section id="cookies"><h2>Cookies</h2>
          <p>Al iniciar sesión o crear una cuenta se utiliza una cookie propia de autenticación, denominada <code>__Host-vs_session</code>. Permite reconocer tu sesión y acceder a tus diseños. No se crean cookies de analítica o publicidad, ni cookies de terceros desde la aplicación.</p>
          <dl className="privacy-details">
            <div><dt>Acceso normal</dt><dd>Cookie de sesión, sin una fecha de conservación permanente en el navegador. Su cierre depende del navegador, incluida la restauración de sesiones. El acceso deja de ser válido como máximo a los 30 días.</dd></div>
            <div><dt>Recordar sesión</dt><dd>Si marcas la opción «Recordar sesión 30 días (usa cookies)», autorizas conservar esa cookie durante un máximo de 30 días desde el acceso. La casilla está desmarcada por defecto y no es necesaria para usar el sitio.</dd></div>
            <div><dt>Retirar la elección</dt><dd>Cierra sesión para eliminar la cookie y revocar ese acceso. Puedes volver a entrar sin marcar «Recordar sesión». También puedes borrar las cookies desde el navegador; borrarlas impide mantener el acceso a tu cuenta.</dd></div>
          </dl>
          <p>La cookie está protegida para que el código de la página no pueda leerla y se transmite por conexiones seguras en producción. Una elección nueva sobre recordar el acceso se aplica al volver a iniciar sesión.</p>
          <p>Tus proyectos se guardan en el servidor; la aplicación no utiliza almacenamiento local del navegador para conservarlos. El navegador puede mantener recursos del sitio en su caché; puedes gestionarlos desde sus ajustes.</p>
          <p>No se muestra un banner para aceptar cookies opcionales durante la visita: la única elección adicional es recordar la sesión y se realiza en el formulario de acceso. Si se añaden cookies para otras finalidades, se informará y se solicitará la elección que corresponda antes de utilizarlas.</p>
        </section>

        <section><h2>Conservación y seguridad</h2>
          <p>La cuenta y sus diseños se conservan mientras la mantengas y hasta que elimines el contenido o solicites su cancelación. No hay un vencimiento automático de las cuentas. Las sesiones dejan de ser válidas al cerrar sesión o al caducar, y sus registros vencidos se depuran en la siguiente limpieza de la aplicación.</p>
          <p>Los contadores de seguridad sin actividad durante más de 48 horas y sin un bloqueo vigente se eliminan cuando vuelve a ejecutarse la limpieza periódica con las peticiones al servidor. No son un historial de navegación.</p>
          <p>La aplicación registra mensajes de arranque y errores técnicos para detectar fallos. No incorpora un historial de las acciones realizadas sobre los diseños.</p>
          <p>{details.accessLogs || 'La configuración de los registros de acceso del servidor está pendiente de confirmar.'}</p>
          <p>La infraestructura supervisa el estado del servidor, como uso de CPU, memoria, disco y red, para mantener el servicio disponible. El historial de esas métricas se conserva durante siete días en el propio servidor. Esta supervisión no es un historial de visitas ni del contenido de tus diseños.</p>
          <p>{details.backups || 'La configuración y el plazo de conservación de los respaldos están pendientes de confirmar.'}</p>
          <p>Se utilizan controles de acceso, contraseñas derivadas con sal aleatoria, sesiones protegidas y límites contra accesos abusivos. La información guardada no está cifrada de extremo a extremo: la administración del servidor puede acceder a ella. Ningún sistema permite garantizar un riesgo de seguridad nulo.</p>
        </section>

        <section id="opciones"><h2>Tus opciones y derechos</h2>
          <p>Puedes consultar y modificar tus diseños, descargar sus parámetros, eliminar diseños o croquis y activar o revocar los enlaces compartidos desde tu cuenta.</p>
          <p>Para solicitar acceso, rectificación, cancelación u oposición al tratamiento de tus datos, limitar su uso o revocar una autorización, utiliza el contacto de privacidad indicado arriba. Incluye tu usuario, lo que solicitas y un medio para recibir la respuesta. Se comprobará tu identidad de forma proporcional; no envíes tu contraseña.</p>
          <p>Las solicitudes se atenderán dentro de los plazos legales aplicables. Si una obligación legal impide eliminar alguna información de inmediato, se explicará el motivo y se limitará su uso a esa obligación. El ejercicio de estos derechos es gratuito, salvo los costes de reproducción o envío permitidos por la ley.</p>
        </section>

        <section><h2>Cambios en este aviso</h2>
          <p>La versión vigente se publicará en esta misma dirección con su fecha de actualización. Los cambios en finalidades o en el uso de cookies que requieran una nueva elección se comunicarán antes de aplicarlos y se solicitará la autorización correspondiente.</p>
        </section>
        <footer className="privacy-references"><a href="https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf" target="_blank" rel="noreferrer">Ley de protección de datos personales de México</a><a href="https://www.aepd.es/guias/guia-cookies.pdf" target="_blank" rel="noreferrer">Guía sobre el uso de cookies</a></footer>
      </article>
    </main>
  </div>;
}
