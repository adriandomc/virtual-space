import { useState } from 'react';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import Brand from '../../shared/ui/Brand';
import LanguageSelector from '../../shared/ui/LanguageSelector';
import { t, useLocale } from '../../shared/i18n/i18n';
import './help.css';
import '../../shared/ui/information.css';

type HelpSection = { id: string; title: string; introduction?: string; steps: string[]; note?: string; image?: { file: string; alt: string; caption: string } };

const sections: HelpSection[] = [
  {
    "id": "start",
    "title": "Tu primer diseño",
    "introduction": "Puedes probar los tres pasos de la portada sin una cuenta. Los cambios del demo son temporales. Para guardar tu propio espacio, entra o crea una cuenta.",
    "steps": [
      "En Mis diseños, pulsa Nuevo diseño. La preparación tiene cuatro pasos opcionales: Croquis, Cubierta, Colores y Decoración. El editor se abre al terminar.",
      "En Croquis, escribe el nombre y las dimensiones en metros. Usa la planta inicial o añade paredes y habitaciones sobre la cuadrícula. El selector Nivel permite preparar cada planta del edificio.",
      "En Cubierta, elige una forma plana, a una agua, a dos aguas o a cuatro aguas. Ajusta sus medidas, inclinación y acabados. Puedes editar sus vértices y caras para crear una forma propia.",
      "En Colores, selecciona paredes, piso o techo y elige sus acabados. En Decoración, agrega muebles, puertas, ventanas y luces. Las puertas y ventanas se añaden manualmente.",
      "Continuar avanza, Atrás permite revisar y Omitir conserva lo que ya hiciste en ese paso. Omitir nunca restablece el diseño. Si sales, usa Continuar preparación en la biblioteca."
    ],
    "note": "Si no cambias nada, empiezas con una planta de 5 × 4 m, paredes y cubierta plana blancas, piso blanco y una luz principal. No se generan muebles, puertas ni ventanas.",
    "image": {
      "file": "setup.jpg",
      "alt": "Preparación del diseño con cuatro pasos y selector de nivel.",
      "caption": "Croquis, Cubierta, Colores y Decoración se pueden omitir sin perder los cambios."
    }
  },
  {
    "id": "account",
    "title": "Cuenta y biblioteca",
    "steps": [
      "Cada cuenta admite 50 diseños y 500 MiB de contenido. La biblioteca de modelos admite hasta 100 modelos y 100 MiB dentro de ese total. Si alcanzas un límite, puedes abrir, exportar o eliminar contenido para liberar espacio; tus cambios locales pendientes se conservan.",
      "Crea tu cuenta con un usuario y una contraseña de 8 a 128 caracteres. Confirma la contraseña y acepta las condiciones. No se pide correo. El usuario se guarda y comprueba siempre en minúsculas.",
      "El botón del ojo muestra u oculta la contraseña. Guárdala en un lugar seguro: no existe recuperación de contraseña. Recordar sesión 30 días es opcional; evita activarlo en dispositivos compartidos.",
      "Mis diseños muestra tus proyectos y las invitaciones que hayas aceptado. Toca una tarjeta para abrirla. La papelera elimina un diseño propio; revisa su nombre antes de confirmar.",
      "Los ajustes de la aplicación permiten cambiar el idioma y preparar el uso sin conexión. El menú Información, a su derecha, reúne esta ayuda, el aviso de privacidad y las condiciones de uso."
    ],
    "note": "La cuenta y sus diseños se eliminan tras al menos tres meses naturales sin actividad autenticada en el servidor. Trabajar únicamente sin conexión no renueva ese plazo.",
    "image": {
      "file": "library.jpg",
      "alt": "Biblioteca de diseños con el botón Nuevo diseño y los menús de ajustes e información.",
      "caption": "Desde la biblioteca puedes abrir un diseño, crear otro y consultar los ajustes."
    }
  },
  {
    "id": "plan",
    "title": "Construir paredes y habitaciones",
    "steps": [
      "Los menús Habitación y Opciones del nivel se cierran al elegir, tocar fuera o pulsar Escape. Con teclado puedes recorrer sus acciones con flechas y volver al botón con Escape. Arrastrar conserva el punto donde agarraste un elemento; al añadir un segundo dedo se cancela el movimiento provisional para navegar sin moverlo.",
      "Abre Planta para trabajar sobre la cuadrícula. Seleccionar permite tocar objetos, paredes, esquinas y huecos. Pared dibuja segmentos: toca el inicio y después cada extremo; Terminar confirma el trazado.",
      "Habitación → Rectángulo necesita dos esquinas opuestas. Trazado libre permite marcar otra forma y cerrar el contorno. Las nuevas habitaciones se añaden a la construcción existente.",
      "Las paredes se dividen en sus intersecciones y las puertas y ventanas conservan su pared cuando la división lo permite. No se puede dividir atravesando una abertura.",
      "Ajustar a cuadrícula coloca puntos por pasos. Líneas rectas limita la dirección a múltiplos de 15°, 30°, 45° o 90°. Longitud fija la medida del siguiente segmento; déjala vacía para trazar libremente.",
      "Arrastra una esquina para mover el punto y sus paredes conectadas, o edita sus coordenadas. Arrastra una pared para mover sus extremos. Dividir pared añade una unión a la mitad; Eliminar pared retira también sus puertas y ventanas.",
      "Habitación → Hueco crea una abertura en el piso. Dibuja su contorno dentro de una superficie y termina. Selecciona el hueco para ajustar sus esquinas o eliminarlo; los huecos ligados a escaleras se retiran con su escalera.",
      "Croquis carga una referencia PNG, JPG o WebP de hasta 10 MiB, 8192 píxeles por lado y 16 millones de píxeles en total para el nivel activo. Cada nivel puede tener una imagen distinta. La imagen no se convierte automáticamente en paredes. Quitar croquis conserva la construcción.",
      "En móvil, usa dos dedos para desplazar y ampliar la planta. En computadora, la rueda cambia el zoom. Cierra los paneles cuando necesites más espacio para dibujar.",
      "Si se interrumpe la conexión o cambia tu acceso mientras dibujas o arrastras, el trazado o movimiento pendiente queda detenido. Reanudar trazado o Aplicar movimiento pendiente requiere recuperar el acceso y conservar una base compatible. Recuperar borrador permite copiar sus coordenadas antes de cerrar la vista."
    ],
    "note": "Enter termina, Retroceso retira el último punto y Escape cancela. Deshacer construcción y Rehacer construcción revisan una operación completa. Una medida o cruce inválido conserva la construcción anterior."
  },
  {
    "id": "levels",
    "title": "Niveles y visibilidad",
    "steps": [
      "El selector Nivel aparece en la preparación y el editor. Elige la planta que quieres modificar. Opciones del nivel permite cambiar su nombre y altura. La elevación se calcula con las alturas inferiores; el proyecto admite hasta 12 niveles.",
      "Nivel vacío crea una losa sin paredes, muebles, aberturas ni luces. Copiar estructura inferior copia la planta y paredes sin duplicar muebles, puertas, ventanas ni luces. Revisa la cubierta superior después de añadir una planta.",
      "Eliminar nivel retira su contenido, escaleras conectadas y huecos asociados. Revisa el nombre antes de confirmar. El proyecto siempre conserva al menos un nivel.",
      "En Opciones de vista → Visibilidad, elige paredes Completas, Recortadas u Ocultas y activa o desactiva Mostrar cubiertas. Niveles visibles ofrece Nivel activo, Niveles inferiores y Edificio completo."
    ],
    "note": "Ocultar paredes o cubiertas cambia la presentación, no la construcción ni las colisiones del recorrido. Los elementos se añaden al nivel activo."
  },
  {
    "id": "stairs",
    "title": "Escaleras y huecos entre niveles",
    "steps": [
      "Necesitas dos niveles consecutivos. Selecciona el nivel inferior y abre Agregar → Escaleras. Elige Recta, Recta con descanso, En L, En U o En caracol. Durante la preparación, abre Escaleras en Croquis o elige Escaleras en Decoración.",
      "En la vista 3D del móvil, al añadir una escalera se cierra el catálogo y queda seleccionada en el visor para colocarla. Pulsa Editar para abrir sus medidas y acabados. En Decoración, Editar te lleva a las propiedades de la escalera seleccionada.",
      "Selecciona la escalera en la escena o en Elementos y pulsa Editar para abrir sus propiedades. Puedes cambiar ancho, número de escalones, huella, posición y giro. La altura total se obtiene de los niveles conectados; Contrahuella muestra la altura de cada peldaño.",
      "En 3D, toca la escalera y usa Mover para arrastrar las flechas o el control horizontal. También puedes arrastrar directamente la escalera seleccionada. Girar muestra el aro para cambiar su orientación. Estos controles están disponibles en Decoración durante la preparación y en el editor, también en móvil. En Planta, arrastra la escalera para cambiar su posición.",
      "En el visor 3D, las flechas del teclado desplazan la escalera seleccionada y Q y E la giran. En el editor, Ajustar a cuadrícula, en Opciones de vista → Movimiento, activa los pasos de posición y los giros de 15°. Desactívalo para colocarla libremente.",
      "El movimiento se guarda al soltar, junto con el hueco del piso superior. Deshacer construcción revierte ambos. En 3D, una ubicación inválida aparece roja y al soltar se conserva la posición anterior; Escape o cancelar el gesto descartan el movimiento provisional. En Planta, un movimiento inválido queda como borrador con un aviso. Cancelar borrador recupera la posición guardada.",
      "Más opciones reúne descanso, espesor del escalón y barandales. En caracol también puedes cambiar los radios interior y exterior, el ángulo de desarrollo y el sentido de giro. Acabado de escalera controla color y material.",
      "La escalera propone un hueco real en el piso superior. Debe caber en una superficie sin superponerse con otros huecos. En Planta puedes seleccionar el hueco y mover sus esquinas; la forma ajustada se conserva como elección propia.",
      "Si no cabe, revisa las medidas del espacio, forma y parámetros antes de añadirla otra vez. Una medida incompatible conserva la última construcción válida. Eliminar escalera retira también su hueco asociado.",
      "Recorrer permite subir y bajar continuamente. Paredes, puertas, muebles, losas y la cara inferior del techo limitan el paso y la altura libre."
    ],
    "note": "Las comprobaciones geométricas sirven para visualizar espacios. No sustituyen el diseño estructural, la normativa de construcción ni una revisión profesional.",
    "image": {
      "file": "stairs.jpg",
      "alt": "Escalera seleccionada en 3D con controles para moverla y girarla.",
      "caption": "Selecciona la escalera y usa Mover o Girar; Editar abre sus medidas y acabados."
    }
  },
  {
    "id": "roofs",
    "title": "Cubiertas y formas propias",
    "steps": [
      "En Cubierta durante la preparación, o Cuarto → Cubiertas en el editor, selecciona una cubierta o usa Añadir cubierta. Forma ofrece Plana, Una agua, Dos aguas y Cuatro aguas; la última necesita una base rectangular.",
      "Cambia ancho, largo, altura y pendiente. Más opciones reúne alero, orientación y espesor. Acabado exterior y Acabado interior permiten elegir color y material por separado.",
      "Editar forma convierte la plantilla en una malla. Elige un vértice y modifica X, Y o Z. Puedes añadir vértices, eliminar un vértice con sus caras o crear y eliminar caras triangulares.",
      "En la vista 3D del editor de cubierta, elige Vértices o Caras y usa Mover, Girar o Escalar. Seleccionar varios permite modificar un conjunto. El ajuste a cuadrícula y las coordenadas numéricas ayudan a colocar la forma con precisión. Encuadrar cubierta centra la vista.",
      "Los cambios de vértices y caras quedan en un borrador. Aplicar forma comprueba el sólido completo antes de guardarlo; Cancelar conserva la cubierta anterior. Deshacer forma y Rehacer forma revisan el borrador.",
      "La malla debe cerrar un volumen sin caras repetidas, atravesadas o sin superficie. Cada borde necesita dos caras con orientación compatible. Completa el sólido antes de aplicar.",
      "Volver de Forma editada a una plantilla pide confirmar el reemplazo. Los acabados se conservan; los vértices y caras se sustituyen por la plantilla elegida.",
      "Si cancelas un borrador modificado, confirma Descartar cambios o usa Seguir editando. Si cambia la cubierta compartida o se retira tu permiso mientras editas, no se aplica el borrador sobre la nueva versión; Recuperar borrador permite copiar su geometría."
    ],
    "note": "El interior sigue la cara inferior real de la cubierta. Una cubierta inclinada no crea un techo plano ficticio debajo; la altura libre depende de esa forma y de las losas existentes."
  },
  {
    "id": "items",
    "title": "Añadir y colocar elementos",
    "steps": [
      "Pulsa Agregar en la barra del visor, también en móvil. Elige una cama, un ropero, un tocador, un buró, una puerta, una ventana, un foco, una escalera o un modelo propio. Las categorías de muebles y escaleras ofrecen distintas formas.",
      "Toca un elemento de la escena o de la lista Elementos para seleccionarlo. Usa Mover o Girar en la barra de selección y arrastra los controles de colores. Editar abre sus propiedades numéricas.",
      "En móvil, abre solo el panel que necesites y ciérralo con la X para recuperar espacio en el visor. Agregar permanece en la barra superior del visor cuando los paneles están cerrados.",
      "Los muebles pueden superponerse o salir del contorno durante la edición. El rojo translúcido indica una ubicación que debes revisar; no impide moverlos. El ajuste a cuadrícula permite avanzar por pasos y se puede desactivar en Opciones de vista → Movimiento.",
      "Para crear una puerta o ventana, indica la pared y sus medidas, incluida la altura. En ventanas, ajusta también Altura desde piso para ubicar el borde inferior. La abertura completa debe caber en la pared y no superponerse con otra.",
      "Las puertas pueden abrir a la derecha, a la izquierda o ser Sólo marco. Selecciona una abertura y arrástrala hacia otra pared para trasladarla. También puedes ajustar su pared y posición en las propiedades.",
      "En las propiedades de un mueble puedes cambiar tamaño, posición, giro, material y color, o eliminarlo. Borrar un mueble no genera decoración de reemplazo."
    ],
    "image": {
      "file": "editor.jpg",
      "alt": "Editor con un mueble seleccionado, controles de movimiento y panel de propiedades.",
      "caption": "Selecciona en la escena y usa los controles o los valores del panel para colocar el elemento."
    }
  },
  {
    "id": "materials",
    "title": "Colores, materiales y calidad visual",
    "steps": [
      "Abre Materiales y despliega el nivel que quieras. Toca una pared en la pequeña planta o elige Piso o Techo; Lista de paredes ofrece una alternativa por nombre. Cambiar de nivel conserva el diseño. Cara de la pared permite editar Lado izquierdo o Lado derecho por separado. Aplicar a todas las paredes reutiliza el color en la cara elegida del nivel activo.",
      "En la barra del visor, abre Color principal con el icono de rueda de colores y pulsa Aplicar para elegir la pintura. Activa Cubeta de pintura y toca una superficie o un elemento en 3D o Planta. En 3D se pinta la cara visible; en Planta se usa la Cara de la pared elegida en Materiales. Arrastrar navega sin pintar y dos dedos desplazan o acercan. Seleccionar vuelve a los controles de movimiento. Con el visor enfocado, Enter o Espacio pinta el elemento seleccionado. En Planta, Seleccionar también recupera las herramientas de construcción.",
      "Activa Cuentagotas y toca una superficie o un elemento en 3D o Planta. Toma el color base del material, sin las sombras ni la iluminación de la pantalla; no copia la textura ni el material. En modelos importados, 3D permite tomar el color de la pieza tocada; Planta usa el color general guardado o un color predeterminado. El color pasa a Color principal y se activa la cubeta para pintar otro elemento. Tomar un color no modifica el diseño. Escape cancela y vuelve a Seleccionar; arrastrar o usar dos dedos navega sin tomar colores. Con el visor enfocado, Enter o Espacio toma el color del elemento seleccionado. También está disponible en Colores y Decoración de la preparación y al editar diseños preparados sin conexión.",
      "La cubeta pinta paredes, pisos, techos, cubiertas, muebles, escaleras, puertas, marcos de ventanas y cuerpos de focos. Conserva el material, el vidrio y la luz emitida. Cada toque guarda un cambio que puedes deshacer; un lector solo puede consultar. En Colores y Decoración de la preparación están las mismas herramientas y Omitir conserva lo pintado.",
      "Abre la muestra de color para ajustar tono, saturación y brillo, escribir un hexadecimal o valores RGB de 0 a 255. Anterior muestra el color al abrir; Nuevo muestra tu previsualización. Puedes copiar el hexadecimal o reutilizar los colores del diseño, incluidos muebles y escaleras. Aplicar guarda una modificación; Cancelar, Escape o tocar fuera descartan la previsualización.",
      "Selecciona el piso para elegir madera, loseta, loseta trabada, damero, mármol o concreto, además de su color.",
      "Techo selecciona la cara interior que queda sobre el nivel activo: la cara inferior de la losa superior o de la cubierta. Su color y material son independientes del piso que queda encima y del acabado exterior de la cubierta.",
      "Selecciona un mueble para cambiar su acabado entre madera, plástico y metal. En modelos importados puedes conservar los materiales originales o elegir un acabado propio. Los tejidos, espejos y otros componentes del catálogo mantienen sus materiales específicos.",
      "En Opciones de vista → Calidad visual elige Estándar, Realista o Hiperrealista. Los dos últimos añaden detalle de superficies e iluminación. Gráficos, dentro de Ajustes, adapta el rendimiento sin cambiar la calidad guardada del diseño."
    ],
    "image": { "file": "materials.jpg", "alt": "Cubeta, cuentagotas, rueda de colores y superficies organizadas por nivel.", "caption": "Toma un color con el cuentagotas o elige Color principal y pinta con la cubeta." },
    "note": "El color y la luz son aproximaciones visuales que dependen de tu pantalla. El modo Hiperrealista no sustituye un cálculo de iluminación ni una muestra física de pintura."
  },
  {
    "id": "graphics",
    "title": "Ajustar el rendimiento del dispositivo",
    "steps": [
      "Abre Ajustes → Gráficos desde la biblioteca o editor. Automático adapta las opciones al dispositivo. Puedes fijar una opción concreta y dejar las demás en Automático; Manual conserva tus valores.",
      "Puedes ajustar sombras, resolución de texturas, escala de renderizado, detalle de geometría, distancia de detalle, sombras de contacto y límite de fotogramas.",
      "Si el visor va lento, reduce la escala y las sombras, usa menos detalle y elige 30 fotogramas. Estándar también reduce el trabajo de materiales frente a Realista e Hiperrealista.",
      "Restablecer gráficos vuelve a la configuración automática. Estas preferencias se guardan solo en este navegador, sin cambiar los ajustes de colaboradores ni de otros dispositivos."
    ],
    "note": "Calidad visual forma parte del diseño. Gráficos controla el rendimiento local y puede tener valores distintos en cada dispositivo."
  },
  {
    "id": "walk",
    "title": "Iluminación y recorrido",
    "steps": [
      "En Luz puedes activar el sol y ajustar hora, orientación e intensidad. Las sombras y la entrada de luz dependen de las aberturas y de las puertas abiertas.",
      "Selecciona un foco para cambiar su posición, intensidad en lúmenes y temperatura de color. Usa su interruptor para encenderlo o apagarlo.",
      "Pulsa Recorrer para entrar al cuarto y Salir para volver a la vista exterior. Arrastra sobre la escena para mirar alrededor.",
      "En computadora, camina con WASD o las flechas; Q y E giran la mirada, y R y F la inclinan. En pantallas táctiles, mueve el joystick para caminar y arrastra en otra zona para mirar.",
      "Toca una puerta o un foco para abrir, cerrar, encender o apagar. También puedes usar el botón que aparece al mirarlo o pulsar Enter o Espacio. Arrastrar para mirar no activa los elementos."
    ],
    "note": "El recorrido respeta las paredes y objetos. En un enlace público o un visor insertado, probar puertas y luces es temporal y no modifica el diseño guardado."
  },
  {
    "id": "workshop",
    "title": "Crear y modificar modelos",
    "introduction": "Crear elemento abre el taller. También puedes seleccionar un mueble existente y usar Editar modelo para tomarlo como base. Guardar crea un modelo nuevo y conserva el original.",
    "steps": [
      "Si cierras con la X o Escape mientras hay modificaciones, el taller pide confirmar Descartar cambios. Seguir editando conserva las piezas y su historial. Aplica o cancela cualquier previsualización de color antes de guardar o actualizar.",
      "En Agregar, elige Formas para usar primitivos, Piezas para añadir tablas, patas y otros componentes, o Muebles para partir de un modelo del catálogo.",
      "Selecciona una pieza en el visor o en Piezas. Mover, Girar y Tamaño activan sus controles. En Editar puedes escribir sus medidas y su posición, cambiar el nombre y elegir material y color.",
      "Activa Snap con el imán cuando necesites precisión. En Alinear → Opciones de snap puedes elegir cuadrícula, ajuste entre piezas, paso de movimiento y paso de giro. Desactívalo para mover libremente.",
      "Para alinear sin arrastrar, elige la pieza a mover y una referencia en Alinear con. Selecciona Ancho, Altura o Fondo y luego un borde, el centro o una opción de contacto. La pieza de referencia permanece en su sitio.",
      "Activa Seleccionar varias y toca las piezas que necesitas. En computadora también puedes usar Mayús, Ctrl o Cmd. Agrupar permite mover, girar, alinear o duplicar el conjunto. Desagrupar recupera las piezas individuales; el lápiz permite entrar a una pieza del grupo.",
      "Para combinar dos piezas, selecciona una sola y abre Editar → Combinar con otra pieza. Elige la segunda y la operación: Unir conserva ambos volúmenes, Restar quita el segundo del primero e Intersección conserva su zona común.",
      "Pulsa Ver resultado para revisar una operación booleana. Aplicar confirma el cambio y Cancelar conserva las piezas previas. El orden de las piezas importa al restar; revisa la frase de la vista previa.",
      "Geometría permite modificar vértices y caras de una pieza. Selecciona el tipo, cambia las coordenadas o añade y elimina componentes. Empieza por medidas y formas simples antes de editar la malla.",
      "Deshacer y Rehacer permiten revisar cambios del taller. Usa Guardar modelo o Guardar copia para terminar. El resultado se guarda como GLB y se añade al diseño.",
      "En Agregar → Modelos propios puedes subir un GLB estático de hasta 20 MB, con texturas PNG o JPEG incorporadas. Este diseño muestra sus modelos; Mis modelos permite copiar uno de tus otros diseños. La copia es independiente del original."
    ],
    "note": "Los GLB con animaciones, recursos externos o compresión no admitida se rechazan. Si un modelo supera los límites de geometría, texturas o almacenamiento, reduce su tamaño antes de subirlo.",
    "image": {
      "file": "workshop.jpg",
      "alt": "Taller de modelos con piezas de un mueble y controles para selección, snap y alineación.",
      "caption": "Construye con piezas sencillas y usa selección múltiple, snap y alineación para acomodarlas."
    }
  },
  {
    "id": "sharing",
    "title": "Compartir y colaborar",
    "steps": [
      "Guarda y sincroniza el diseño antes de abrir Compartir. Solo el propietario puede administrar accesos. Compartir no está disponible en modo sin conexión.",
      "En Personas, escribe el nombre de un usuario existente y elige Lector o Editor. Pulsa Invitar. La otra persona recibe una notificación en la campana y debe aceptar la invitación.",
      "Un lector puede consultar y recorrer el diseño. Un editor puede modificarlo contigo. El propietario puede cambiar el rol o retirar el acceso desde la lista de personas.",
      "La construcción se confirma como una operación completa. Si otra persona modifica la estructura antes de tu confirmación, revisa el aviso y conserva o recupera tu trabajo antes de reintentarlo.",
      "Si un cambio compartido es rechazado, Cambios recuperados conserva una copia privada del diseño en este dispositivo y cuenta. Puedes volver a abrirla antes de descartarla, siempre que el navegador conserve sus datos.",
      "Descargar copia necesita los archivos del diseño. Puede fallar si ya no tienes acceso a un modelo o croquis. En Recuperar borrador siempre puedes copiar los datos del diseño; ese JSON conserva su estructura, pero no incluye los archivos ni es un paquete importable. Guarda la copia antes de descartar los cambios.",
      "Crear enlace habilita un acceso público de lectura sin cuenta. Cualquier persona que reciba ese enlace puede ver el diseño. Desactivar enlace impide nuevas lecturas públicas; no borra copias ya descargadas.",
      "En Insertar, copia el enlace del visor o el código iframe para otra web. Ese visor muestra solo la escena, el recorrido y los tres modos visuales. Necesita que el enlace público siga activo.",
      "Los diseños con colaboración o enlace público requieren conexión para editar. Si quieres trabajar con ellos sin red, crea una copia personal desde la biblioteca mientras tengas conexión. Esa copia no conserva colaboradores y no modifica el original."
    ],
    "note": "El visor público muestra lo sincronizado en el servidor. Los cambios que solo están guardados en tu dispositivo todavía no se comparten.",
    "image": {
      "file": "sharing.jpg",
      "alt": "Panel Compartir con invitaciones a usuarios y selección de rol lector o editor.",
      "caption": "Invita por nombre de usuario y asigna el acceso que necesita cada persona."
    }
  },
  {
    "id": "offline",
    "title": "Preparar y usar sin conexión",
    "steps": [
      "Con conexión, entra a tu cuenta y abre Ajustes → Sin conexión desde la biblioteca o el editor. Pulsa Preparar diseños y espera a que Aplicación y Diseños y modelos estén disponibles.",
      "La preparación descarga todos los niveles de tus diseños privados, los croquis de cada planta, sus modelos y tu biblioteca de modelos. Un diseño con colaboradores, invitaciones pendientes o enlace público necesita una copia personal independiente.",
      "Activa Modo sin conexión para trabajar localmente, incluso si tienes internet. La elección se conserva al cerrar y reabrir y se comparte entre las pestañas de esa cuenta.",
      "Puedes abrir la biblioteca, crear y editar diseños, dibujar plantas, importar proyectos, crear modelos y recorrer habitaciones. No se envían cambios ni se consultan notificaciones. Compartir y la colaboración permanecen desactivados.",
      "Cuando quieras enviar tus cambios, vuelve a tener conexión y desactiva el modo. La aplicación comprueba la cuenta y los permisos y sincroniza todos los pendientes, también los diseños que no tienes abiertos y los modelos no insertados.",
      "Si la sesión venció, puedes seguir usando y descargando el trabajo local. Para sincronizar debes entrar de nuevo en la misma cuenta. Mantén la aplicación abierta hasta que terminen los cambios pendientes.",
      "Para instalarla, usa Instalar 3D Space si aparece en Ajustes, o la opción de instalar del navegador. En iPhone o iPad, abre el menú Compartir de Safari y elige Añadir a pantalla de inicio.",
      "Al abrir, la aplicación se actualiza automáticamente si no has comenzado a trabajar y no hay pendientes en ninguna pestaña. Si ya estás trabajando, Actualización disponible permite Actualizar ahora o Recordar más tarde; también puedes hacerlo desde Ajustes. Termina o cancela campos, colores y trazados y guarda los modelos antes de actualizar. Los pendientes ya guardados en el dispositivo se conservan sin exigir sincronizarlos. Volver desde segundo plano no recarga tu trabajo. En modo sin conexión no se buscan ni aplican actualizaciones.",
      "Si una pestaña tiene otra versión de la aplicación, actualiza antes de iniciar nuevas ediciones. Puedes consultar y exportar los diseños; el trabajo anterior permanece guardado."
    ],
    "note": "Prepara el dispositivo antes de quedarte sin internet. El navegador puede borrar datos o quedarse sin espacio: conserva una copia descargada de lo importante. Trabajar sin red no renueva el plazo de inactividad de la cuenta.",
    "image": {
      "file": "offline.jpg",
      "alt": "Ajustes con preparación de diseños, modo sin conexión, almacenamiento y actualizaciones.",
      "caption": "Comprueba disponibilidad y cambios pendientes antes de activar el modo sin conexión."
    }
  },
  {
    "id": "recovery",
    "title": "Guardar, exportar y resolver problemas",
    "steps": [
      "Los cambios válidos se guardan automáticamente. Revisa el indicador de guardado: estar guardado en este dispositivo no siempre significa que el servidor ya lo recibió. No borres los datos del navegador mientras tengas cambios pendientes.",
      "Archivo → Descargar copia guarda un archivo .3dspace con todos los niveles, croquis y GLB del diseño. En móvil, estas acciones están en Opciones de vista. Conserva el archivo fuera del almacenamiento del navegador.",
      "Archivo → Abrir proyecto acepta el paquete actual de 3D Space. Se validan el documento y todos sus archivos antes de aplicar la importación. No se admiten formatos anteriores ni JSON sueltos; una importación fallida conserva el diseño previo.",
      "Si aparece un conflicto, descarga primero tus cambios. Puedes recuperar el trabajo como copia independiente o elegir Usar versión guardada para conservar la del servidor. No cierres ni descartes el aviso sin revisar qué versión necesitas.",
      "Si falta un recurso o no termina una descarga, usa Reintentar cuando tengas conexión. Una preparación incompleta no se considera disponible. Si falta espacio, libera almacenamiento ajeno a tus diseños y vuelve a preparar.",
      "Si un campo obligatorio queda vacío o contiene un valor inválido, puedes terminar de escribir antes de salir del campo. La aplicación conserva el último valor válido cuando no puede guardar la nueva entrada. Revisa el aviso junto al campo.",
      "Antes de cerrar sesión, sincroniza o descarga los pendientes. Las actualizaciones de la aplicación esperan a que se confirme el guardado local; no cierres otras pestañas con trabajo sin guardar para forzar una actualización."
    ],
    "note": "Los respaldos del servidor no incluyen cambios que aún no hayas sincronizado. Esta guía no garantiza que el navegador conserve sus datos ni que un respaldo recupere cambios posteriores a su fecha."
  }
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
