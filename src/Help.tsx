import { useState } from 'react';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import Brand from './Brand';
import LanguageSelector from './LanguageSelector';
import { t, useLocale } from './i18n';
import './help.css';
import './information.css';

type HelpSection = { id: string; title: string; introduction?: string; steps: string[]; note?: string; image?: { file: string; alt: string; caption: string } };

const sections: HelpSection[] = [
  {
    id: 'start', title: 'Tu primer diseño',
    introduction: 'Puedes probar los tres pasos de la portada sin una cuenta. Los cambios del demo son temporales. Para guardar tu propio espacio, entra o crea una cuenta.',
    steps: [
      'En Mis diseños, pulsa Nuevo diseño. Se abrirá la preparación en una página aparte del editor.',
      'En Croquis, escribe el nombre y las dimensiones del cuarto en metros. Puedes dibujar una planta distinta o usar una imagen como referencia.',
      'En Colores, elige una superficie y cambia su color. Selecciona también el material del piso. Puedes volver a modificarlo todo en el editor.',
      'En Decoración, añade los elementos que necesites. Las puertas y ventanas se agregan manualmente; el cuarto incluye una luz principal.',
      'Usa Continuar para avanzar, Atrás para revisar o Omitir para restablecer ese paso. Al terminar, entra al editor. Si sales antes, la biblioteca permite Continuar preparación.',
    ],
    note: 'Si omites todos los pasos, comienzas con un cuarto rectangular de 5 × 4 m, acabados blancos y una luz, sin muebles, puertas ni ventanas.',
    image: { file: 'setup.jpg', alt: 'Preparación de un diseño con dimensiones y planta sobre cuadrícula.', caption: 'La preparación separa Croquis, Colores y Decoración. Cada paso es opcional.' },
  },
  {
    id: 'account', title: 'Cuenta y biblioteca',
    steps: [
      'Crea tu cuenta con un usuario y una contraseña de 8 a 128 caracteres. Confirma la contraseña y acepta las condiciones. No se pide correo. El usuario se guarda y comprueba siempre en minúsculas.',
      'El botón del ojo muestra u oculta la contraseña. Guárdala en un lugar seguro: no existe recuperación de contraseña. Recordar sesión 30 días es opcional; evita activarlo en dispositivos compartidos.',
      'Mis diseños muestra tus proyectos y las invitaciones que hayas aceptado. Toca una tarjeta para abrirla. La papelera elimina un diseño propio; revisa su nombre antes de confirmar.',
      'Los ajustes de la aplicación permiten cambiar el idioma y preparar el uso sin conexión. El menú Información, a su derecha, reúne esta ayuda, el aviso de privacidad y las condiciones de uso.',
    ],
    note: 'La cuenta y sus diseños se eliminan tras al menos tres meses naturales sin actividad autenticada en el servidor. Trabajar únicamente sin conexión no renueva ese plazo.',
    image: { file: 'library.jpg', alt: 'Biblioteca de diseños con el botón Nuevo diseño y los menús de ajustes e información.', caption: 'Desde la biblioteca puedes abrir un diseño, crear otro y consultar los ajustes.' },
  },
  {
    id: 'plan', title: 'Dibujar y ajustar el cuarto',
    steps: [
      'En el editor, abre Cuarto para cambiar ancho, largo, altura y espesor de muro. Editar planta o la pestaña Planta abre la vista superior.',
      'Pulsa Dibujar planta y marca las esquinas en orden sobre la cuadrícula. Necesitas al menos tres puntos. Toca el primero otra vez o pulsa Cerrar planta para terminar.',
      'Activa Ajustar a cuadrícula para colocar puntos por pasos. Líneas rectas limita la dirección a múltiplos del ángulo elegido: 15°, 30°, 45° o 90°. Puedes usar ambas opciones juntas o desactivarlas.',
      'Escribe el Ancho total trazado para establecer la escala en metros. Si necesitas una esquina exacta, abre Coordenadas, introduce X y Z y pulsa Añadir esquina.',
      'Croquis permite cargar una referencia PNG, JPG o WebP de hasta 10 MB. La imagen sirve de fondo: debes trazar el contorno manualmente. Quitar croquis elimina la referencia, no la planta.',
      'Arrastra las esquinas de una planta existente para modificar su forma. Al cambiar medidas, los muebles conservan su posición y las aberturas se adaptan a las paredes. Si no caben, se conserva la última planta válida.',
    ],
    note: 'Mientras dibujas, Enter cierra, Retroceso deshace el último punto y Escape cancela. En móvil también están disponibles los botones de cerrar, deshacer y cancelar.',
  },
  {
    id: 'items', title: 'Añadir y colocar elementos',
    steps: [
      'Pulsa Agregar en la barra del visor, también en móvil. Elige una cama, un ropero, un tocador, un buró, una puerta, una ventana, un foco o un modelo propio. Las categorías de muebles ofrecen varios modelos.',
      'Toca un elemento de la escena o de la lista Elementos para seleccionarlo. Usa Mover o Girar en la barra de selección y arrastra los controles de colores. Editar abre sus propiedades numéricas.',
      'En móvil, abre solo el panel que necesites y ciérralo con la X para recuperar espacio en el visor. Agregar permanece en la barra superior del visor cuando los paneles están cerrados.',
      'Los muebles pueden superponerse o salir del contorno durante la edición. El rojo translúcido indica una ubicación que debes revisar; no impide moverlos. El ajuste a cuadrícula permite avanzar por pasos y se puede desactivar en Opciones de vista → Movimiento.',
      'Para crear una puerta o ventana, indica la pared y sus medidas, incluida la altura. En ventanas, ajusta también Altura desde piso para ubicar el borde inferior. La abertura completa debe caber en la pared y no superponerse con otra.',
      'Las puertas pueden abrir a la derecha, a la izquierda o ser Sólo marco. Selecciona una abertura y arrástrala hacia otra pared para trasladarla. También puedes ajustar su pared y posición en las propiedades.',
      'En las propiedades de un mueble puedes cambiar tamaño, posición, giro, material y color, o eliminarlo. Borrar un mueble no genera decoración de reemplazo.',
    ],
    image: { file: 'editor.jpg', alt: 'Editor con un mueble seleccionado, controles de movimiento y panel de propiedades.', caption: 'Selecciona en la escena y usa los controles o los valores del panel para colocar el elemento.' },
  },
  {
    id: 'materials', title: 'Colores, materiales y calidad visual',
    steps: [
      'Abre Materiales o selecciona una pared, el piso o el techo. Elige la superficie que quieres modificar. Aplicar a todas las paredes reutiliza el color de la pared seleccionada.',
      'Puedes usar el selector de color o escribir un hexadecimal de tres o seis dígitos, con o sin #. El botón de copiar permite reutilizarlo. En este cuarto reúne los colores que ya están aplicados.',
      'Selecciona el piso para elegir madera, loseta, loseta trabada, damero, mármol o concreto, además de su color.',
      'Selecciona un mueble para cambiar su acabado entre madera, plástico y metal. En modelos importados puedes conservar los materiales originales o elegir un acabado propio. Los tejidos, espejos y otros componentes del catálogo mantienen sus materiales específicos.',
      'En Opciones de vista → Calidad visual elige Estándar, Realista o Hiperrealista. Los dos últimos añaden detalle de superficies e iluminación. Si el dispositivo va lento o se calienta, usa Estándar.',
    ],
    note: 'El color y la luz son aproximaciones visuales que dependen de tu pantalla. El modo Hiperrealista no sustituye un cálculo de iluminación ni una muestra física de pintura.',
  },
  {
    id: 'walk', title: 'Iluminación y recorrido',
    steps: [
      'En Luz puedes activar el sol y ajustar hora, orientación e intensidad. Las sombras y la entrada de luz dependen de las aberturas y de las puertas abiertas.',
      'Selecciona un foco para cambiar su posición, intensidad en lúmenes y temperatura de color. Usa su interruptor para encenderlo o apagarlo.',
      'Pulsa Recorrer para entrar al cuarto y Salir para volver a la vista exterior. Arrastra sobre la escena para mirar alrededor.',
      'En computadora, camina con WASD o las flechas; Q y E giran la mirada, y R y F la inclinan. En pantallas táctiles, mueve el joystick para caminar y arrastra en otra zona para mirar.',
      'Toca una puerta o un foco para abrir, cerrar, encender o apagar. También puedes usar el botón que aparece al mirarlo o pulsar Enter o Espacio. Arrastrar para mirar no activa los elementos.',
    ],
    note: 'El recorrido respeta las paredes y objetos. En un enlace público o un visor insertado, probar puertas y luces es temporal y no modifica el diseño guardado.',
  },
  {
    id: 'workshop', title: 'Crear y modificar modelos',
    introduction: 'Crear elemento abre el taller. También puedes seleccionar un mueble existente y usar Editar modelo para tomarlo como base. Guardar crea un modelo nuevo y conserva el original.',
    steps: [
      'En Agregar, elige Formas para usar primitivos, Piezas para añadir tablas, patas y otros componentes, o Muebles para partir de un modelo del catálogo.',
      'Selecciona una pieza en el visor o en Piezas. Mover, Girar y Tamaño activan sus controles. En Editar puedes escribir sus medidas y su posición, cambiar el nombre y elegir material y color.',
      'Activa Snap con el imán cuando necesites precisión. En Alinear → Opciones de snap puedes elegir cuadrícula, ajuste entre piezas, paso de movimiento y paso de giro. Desactívalo para mover libremente.',
      'Para alinear sin arrastrar, elige la pieza a mover y una referencia en Alinear con. Selecciona Ancho, Altura o Fondo y luego un borde, el centro o una opción de contacto. La pieza de referencia permanece en su sitio.',
      'Activa Seleccionar varias y toca las piezas que necesitas. En computadora también puedes usar Mayús, Ctrl o Cmd. Agrupar permite mover, girar, alinear o duplicar el conjunto. Desagrupar recupera las piezas individuales; el lápiz permite entrar a una pieza del grupo.',
      'Para combinar dos piezas, selecciona una sola y abre Editar → Combinar con otra pieza. Elige la segunda y la operación: Unir conserva ambos volúmenes, Restar quita el segundo del primero e Intersección conserva su zona común.',
      'Pulsa Ver resultado para revisar una operación booleana. Aplicar confirma el cambio y Cancelar conserva las piezas previas. El orden de las piezas importa al restar; revisa la frase de la vista previa.',
      'Geometría permite modificar vértices y caras de una pieza. Selecciona el tipo, cambia las coordenadas o añade y elimina componentes. Empieza por medidas y formas simples antes de editar la malla.',
      'Deshacer y Rehacer permiten revisar cambios del taller. Usa Guardar modelo o Guardar copia para terminar. El resultado se guarda como GLB y se añade al diseño.',
      'En Agregar → Modelos propios puedes subir un GLB estático de hasta 20 MB, con texturas PNG o JPEG incorporadas. Este diseño muestra sus modelos; Mis modelos permite copiar uno de tus otros diseños. La copia es independiente del original.',
    ],
    note: 'Los GLB con animaciones, recursos externos o compresión no admitida se rechazan. Si un modelo supera los límites de geometría, texturas o almacenamiento, reduce su tamaño antes de subirlo.',
    image: { file: 'workshop.jpg', alt: 'Taller de modelos con piezas de un mueble y controles para selección, snap y alineación.', caption: 'Construye con piezas sencillas y usa selección múltiple, snap y alineación para acomodarlas.' },
  },
  {
    id: 'sharing', title: 'Compartir y colaborar',
    steps: [
      'Guarda y sincroniza el diseño antes de abrir Compartir. Solo el propietario puede administrar accesos. Compartir no está disponible en modo sin conexión.',
      'En Personas, escribe el nombre de un usuario existente y elige Lector o Editor. Pulsa Invitar. La otra persona recibe una notificación en la campana y debe aceptar la invitación.',
      'Un lector puede consultar y recorrer el diseño. Un editor puede modificarlo contigo. El propietario puede cambiar el rol o retirar el acceso desde la lista de personas.',
      'Crear enlace habilita un acceso público de lectura sin cuenta. Cualquier persona que reciba ese enlace puede ver el diseño. Desactivar enlace impide nuevas lecturas públicas; no borra copias ya descargadas.',
      'En Insertar, copia el enlace del visor o el código iframe para otra web. Ese visor muestra solo la escena, el recorrido y los tres modos visuales. Necesita que el enlace público siga activo.',
      'Los diseños con colaboración o enlace público requieren conexión para editar. Si quieres trabajar con ellos sin red, crea una copia personal desde la biblioteca mientras tengas conexión. Esa copia no conserva colaboradores y no modifica el original.',
    ],
    note: 'El visor público muestra lo sincronizado en el servidor. Los cambios que solo están guardados en tu dispositivo todavía no se comparten.',
    image: { file: 'sharing.jpg', alt: 'Panel Compartir con invitaciones a usuarios y selección de rol lector o editor.', caption: 'Invita por nombre de usuario y asigna el acceso que necesita cada persona.' },
  },
  {
    id: 'offline', title: 'Preparar y usar sin conexión',
    steps: [
      'Con conexión, entra a tu cuenta y abre Ajustes → Sin conexión desde la biblioteca o el editor. Pulsa Preparar diseños y espera a que Aplicación y Diseños y modelos estén disponibles.',
      'La preparación descarga tus diseños privados, sus croquis, modelos y tu biblioteca de modelos. Un diseño con colaboradores, invitaciones pendientes o enlace público necesita una copia personal independiente.',
      'Activa Modo sin conexión para trabajar localmente, incluso si tienes internet. La elección se conserva al cerrar y reabrir y se comparte entre las pestañas de esa cuenta.',
      'Puedes abrir la biblioteca, crear y editar diseños, dibujar plantas, importar proyectos, crear modelos y recorrer habitaciones. No se envían cambios ni se consultan notificaciones. Compartir y la colaboración permanecen desactivados.',
      'Cuando quieras enviar tus cambios, vuelve a tener conexión y desactiva el modo. La aplicación comprueba la cuenta y los permisos y sincroniza todos los pendientes, también los diseños que no tienes abiertos y los modelos no insertados.',
      'Si la sesión venció, puedes seguir usando y descargando el trabajo local. Para sincronizar debes entrar de nuevo en la misma cuenta. Mantén la aplicación abierta hasta que terminen los cambios pendientes.',
      'Para instalarla, usa Instalar 3D Space si aparece en Ajustes, o la opción de instalar del navegador. En iPhone o iPad, abre el menú Compartir de Safari y elige Añadir a pantalla de inicio.',
    ],
    note: 'Prepara el dispositivo antes de quedarte sin internet. El navegador puede borrar datos o quedarse sin espacio: conserva una copia descargada de lo importante. Trabajar sin red no renueva el plazo de inactividad de la cuenta.',
    image: { file: 'offline.jpg', alt: 'Ajustes con preparación de diseños, modo sin conexión, almacenamiento y actualizaciones.', caption: 'Comprueba disponibilidad y cambios pendientes antes de activar el modo sin conexión.' },
  },
  {
    id: 'recovery', title: 'Guardar, exportar y resolver problemas',
    steps: [
      'Los cambios válidos se guardan automáticamente. Revisa el indicador de guardado: estar guardado en este dispositivo no siempre significa que el servidor ya lo recibió. No borres los datos del navegador mientras tengas cambios pendientes.',
      'Archivo → Descargar copia guarda un paquete completo del diseño, su croquis y los GLB utilizados. En móvil, estas acciones están en Opciones de vista. Conserva el archivo fuera del almacenamiento del navegador.',
      'Archivo → Abrir proyecto permite usar ese paquete en un diseño. Se comprueban el documento y sus recursos antes de aplicarlo. No se admiten JSON antiguos ni archivos de parámetros sueltos.',
      'Si aparece un conflicto, descarga primero tus cambios. Puedes recuperar el trabajo como copia independiente o elegir Usar versión guardada para conservar la del servidor. No cierres ni descartes el aviso sin revisar qué versión necesitas.',
      'Si falta un recurso o no termina una descarga, usa Reintentar cuando tengas conexión. Una preparación incompleta no se considera disponible. Si falta espacio, libera almacenamiento ajeno a tus diseños y vuelve a preparar.',
      'Si un campo obligatorio queda vacío o contiene un valor inválido, puedes terminar de escribir antes de salir del campo. La aplicación conserva el último valor válido cuando no puede guardar la nueva entrada. Revisa el aviso junto al campo.',
      'Antes de cerrar sesión, sincroniza o descarga los pendientes. Las actualizaciones de la aplicación esperan a que se confirme el guardado local; no cierres otras pestañas con trabajo sin guardar para forzar una actualización.',
    ],
    note: 'Los respaldos del servidor no incluyen cambios que aún no hayas sincronizado. Esta guía no garantiza que el navegador conserve sus datos ni que un respaldo recupere cambios posteriores a su fecha.',
  },
];

const searchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const searchable = (section: HelpSection) => searchText([section.title, section.introduction, ...section.steps, section.note, section.image?.caption].filter(Boolean).map(value => t(value!)).join(' '));

export default function Help() {
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const query = searchText(search.trim());
  const visible = sections.filter(section => !query || searchable(section).includes(query));
  return <div className="help-page">
    <header className="help-header"><a href="/" aria-label={t('3D Space, inicio')}><Brand className="help-brand" /></a><div className="help-header-actions"><LanguageSelector /><a className="help-back" href="/designs"><ArrowLeft size={18} />{t('Mis diseños')}</a></div></header>
    <main className="help-main" id="help-top">
      <div className="help-heading"><BookOpen size={27} aria-hidden="true" /><h1>{t('Ayuda y guía de inicio')}</h1><p>{t('Pasos para crear, editar y guardar tus espacios en computadora, tableta o celular.')}</p></div>
      <label className="help-search"><Search size={20} aria-hidden="true" /><span className="help-sr-only">{t('Buscar en la ayuda')}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Buscar en la ayuda')} /></label>
      <div className="help-layout">
        <nav className="help-index" aria-label={t('Temas de ayuda')}><details open><summary>{t('En esta guía')}</summary><ul>{visible.map(section => <li key={section.id}><a href={'#' + section.id}>{t(section.title)}</a></li>)}</ul></details></nav>
        <div className="help-content">
          {!visible.length && <p className="help-no-results" role="status">{t('No se encontraron temas. Prueba con otra palabra.')}</p>}
          {visible.map(section => <section className="help-section" key={section.id} id={section.id} aria-labelledby={section.id + '-title'}>
            <h2 id={section.id + '-title'}>{t(section.title)}</h2>
            {section.introduction && <p>{t(section.introduction)}</p>}
            <ol>{section.steps.map(step => <li key={step}>{t(step)}</li>)}</ol>
            {section.image && <figure><a href={'/help/' + locale + '/' + section.image.file} target="_blank" rel="noopener" aria-label={t('Ampliar captura: {{description}}', { description: t(section.image.alt) })}><img src={'/help/' + locale + '/' + section.image.file} alt={t(section.image.alt)} loading="lazy" decoding="async" width="1280" height="800" /></a><figcaption>{t(section.image.caption)} <span>{t('Toca la captura para ampliarla.')}</span></figcaption></figure>}
            {section.note && <p className="help-note">{t(section.note)}</p>}
            <a className="help-to-top" href="#help-top">{t('Volver al índice')}</a>
          </section>)}
        </div>
      </div>
    </main>
  </div>;
}
