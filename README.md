# 3D Space

Aplicación React + TypeScript + Three.js para construir la planta de un cuarto, elegir colores de pared y recorrerlo en 3D. Usa materiales TSL y el renderizador WebGPU de Three.js, con alternativa WebGL cuando el dispositivo no ofrece WebGPU. Un servidor Node.js guarda cada proyecto y su croquis en SQLite.

## Cuentas y diseños

La portada `/` muestra tres demos interactivos: vista del cuarto, edición de un ropero y recorrido interior. Los demos funcionan sin cuenta y sus cambios son temporales. `/login` permite entrar o crear una cuenta; `/designs` abre la biblioteca y `/editor?room=<identificador>` abre un diseño. Durante la preparación se añade `&setup=1` a esa dirección.

El acceso sólo necesita usuario y contraseña. El usuario se normaliza en minúsculas, admite de 3 a 32 letras ASCII, números o guiones bajos. La contraseña admite de 8 a 128 caracteres y se confirma al registrarse. No hay correo ni recuperación automática de contraseñas. El registro exige aceptar las condiciones de uso mediante una casilla inicialmente desmarcada: el servidor comprueba `termsVersion` y guarda la versión y fecha aceptadas. El servicio alojado será siempre gratuito mientras esté disponible, sin pagos ni suscripciones.

**Mis diseños** permite crear, abrir y eliminar diseños propios y abrir los diseños a los que te hayan invitado. Las modificaciones y el croquis se guardan automáticamente; el estado distingue el guardado en este dispositivo de la sincronización con el servidor. Espera a que termine el guardado antes de cerrar la página. El propietario administra los permisos y elimina el diseño; los editores también pueden modificarlo y los lectores pueden consultarlo.

**Compartir → Personas** invita a un usuario existente como lector o editor. La invitación llega a su campana de notificaciones y requiere aceptación. El propietario puede cambiar el rol o retirar el acceso; los cambios se aplican a las conexiones abiertas. El enlace público de lectura es independiente y no concede edición.

Los cambios de editores se combinan con Yjs por WebSocket y se guardan en SQLite antes de confirmar el guardado. En diseños con colaboración o enlace público, la edición se pausa al perder conexión y los cambios pendientes se reenvían al reconectar. Cambios incompatibles con las nuevas dimensiones se rechazan conservando una versión válida. Las notificaciones usan SSE, con consulta periódica de respaldo si el canal falla. Ambos canales comparten el puerto HTTP de la aplicación; el proxy de Coolify debe permitir WebSocket y mantener las conexiones SSE.

Desde **Ajustes → Sin conexión** se prepara la aplicación, los diseños privados propios y la biblioteca de modelos para ese dispositivo. El modo se puede mantener activado aunque exista internet: no consulta ni envía datos, abre la biblioteca local y permite crear diseños y modelos nuevos. El apartado «Uso sin conexión» explica la preparación, la sincronización y sus límites.

**Agregar** incluye 10 roperos, 10 tocadores y 10 burós con formas distintas. **Modelos propios** permite crear un modelo o subir un GLB estático con texturas PNG/JPEG incorporadas, de hasta 20 MB. No se admiten archivos externos, animaciones ni extensiones o compresores glTF. Se comprueban geometría, índices, transformaciones, jerarquía y memoria de texturas antes de almacenarlo. Los modelos pertenecen al diseño donde se suben: un editor puede aportarlos, pero el propietario conserva su gestión. Los modelos no referenciados no se exponen por el enlace público. Se limita cada modelo a 200.000 triángulos y 512 nodos; cada diseño, a un millón de triángulos, 30 modelos distintos, 100 MB y 16 millones de píxeles de textura decodificada. La biblioteca de modelos de cada propietario admite hasta 100 MB en total.

**Editar modelo** abre el taller para partir de un mueble del catálogo o uno importado. Permite añadir, duplicar o eliminar piezas, editar posición, giro, escala y materiales, y mover, añadir o eliminar vértices y caras. **Seleccionar varias** permite marcar piezas en móvil; en escritorio también puedes usar Mayús, Ctrl o Cmd. **Agrupar** conserva una selección para moverla, girarla, alinearla o duplicarla junta. **Desagrupar** recupera las piezas individuales; el lápiz permite editar una pieza dentro del grupo. Los grupos se conservan al guardar y reabrir el GLB. Guardar genera un GLB nuevo y lo añade al diseño sin alterar el original. Los controles 3D admiten ratón y touch. Los originales pueden conservar sus texturas; los acabados de madera, plástico y metal responden a los tres modos visuales.

La biblioteca distingue **Este diseño** y **Mis modelos**. La segunda opción reúne los modelos de los diseños de tu cuenta. Al añadir uno procedente de otro diseño se guarda una copia independiente en el destino; eliminar el diseño de origen no afecta esa copia. Las aportaciones a diseños de otros propietarios quedan en la biblioteca de esos diseños.

La eliminación por inactividad de la cuenta propietaria elimina también sus diseños compartidos y modelos; la actividad de los colaboradores no renueva su cuenta. Las aportaciones a diseños de otras personas permanecen en esos diseños cuando se elimina la cuenta que las aportó. Las copias de seguridad incluyen los archivos GLB, permisos y documentos Yjs; el registro de eliminaciones impide restaurar modelos o accesos retirados.

**Nuevo diseño** abre una preparación aparte del editor: **Croquis → Colores → Decoración**. Cada paso permite continuar, volver u omitirlo. Los diseños nuevos empiezan sin muebles, puertas ni ventanas, con una sola luz principal encendida. Omitir Croquis conserva la estructura normal de 5 × 4 m; omitir Colores deja paredes, techo y piso en blancos; omitir Decoración conserva sólo la luz principal. Puedes trazar o cargar la planta, ajustar medidas, elegir acabados y añadir muebles, aberturas o focos antes de entrar al editor. Las decisiones y el paso actual se guardan en el servidor; **Continuar preparación** en la biblioteca permite retomarlo. Entrar al editor espera a que se guarden los cambios.

Los diseños son privados inicialmente. **Compartir → Crear enlace** habilita una dirección de lectura `/editor?room=<identificador>`: quien reciba ese enlace puede ver el diseño y su croquis, y recorrerlo sin iniciar sesión. **Desactivar enlace** revoca ese acceso. El enlace no concede permisos de edición.

**Compartir → Insertar** ofrece un enlace `/embed?room=<identificador>` y el código de un iframe para pegarlo en otra web. Solo muestra el visor, el cambio a recorrido y los modos Estándar, Realista e Hiperrealista. Puertas y luces se prueban temporalmente, sin guardar cambios. Requiere el enlace público activado; los diseños privados no se muestran aunque el visitante tenga una sesión iniciada. La vista consulta los cambios guardados cada 15 segundos mientras esté visible. Desactivar el enlace bloquea las nuevas lecturas; una página abierta lo detecta en su siguiente consulta. Solo `/embed` permite ser insertado; el acceso, el editor y las demás páginas mantienen su protección contra iframes. La web receptora debe permitir ese origen en su propia política de contenido y conservar permisos de scripts si utiliza un iframe con sandbox.

Las cuentas, sesiones, diseños, croquis y contadores de seguridad se guardan en `/data/accounts.sqlite`. Un único esquema versionado inicializa la base de forma atómica; el arranque rechaza bases incompatibles sin borrarlas ni convertirlas. Las contraseñas se guardan con scrypt y sal aleatoria; los tokens de sesión sólo se guardan como hashes. El token de sesión vence como máximo a los 30 días y se revoca al cerrar sesión. La cookie es de sesión por defecto; sólo se conserva durante 30 días si el usuario marca **Recordar sesión 30 días (usa cookies)** al entrar o registrarse. Esta opción está desmarcada inicialmente y se valida también en el servidor.

Los límites persisten tras reinicios: 5 intentos de acceso por usuario/IP en 15 minutos, 30 intentos totales por IP en ese intervalo y bloqueo progresivo tras 10 fallos, de 15 minutos hasta 24 horas. Se agrupan direcciones IPv6 por `/64`. El registro se limita a 5 cuentas por IP/hora; también hay límites de peticiones, creación de diseños y cargas. La derivación de contraseñas limita su concurrencia para mantener controlado el uso de memoria. Los límites de una IP no bloquean globalmente una cuenta.

**Archivo → Descargar copia** y la recuperación de borradores usan el mismo paquete autocontenido `3d-space-project`, versión **2**: incluye el documento `Room.version: 2`, el croquis y todos los GLB referenciados. **Archivo → Abrir proyecto** valida el paquete y sus recursos antes de aplicarlo en una transacción local completa. Los identificadores de modelos se renuevan para conservar copias independientes. Sólo se admite ese formato completo; un archivo de parámetros suelto no se interpreta como un diseño válido. El respaldo diario de SQLite incluye las cuentas, diseños, croquis, modelos, permisos, sesiones y contadores. Los procedimientos de comprobación y recuperación se describen abajo.

Cada cuenta se conserva durante al menos **3 meses naturales** desde su última actividad autenticada correcta. Se calcula en UTC y, si el mes de destino no tiene ese día, se usa su último día; no se sustituyen tres meses por 90 días. Entrar o realizar una petición autenticada correcta a la API renueva el plazo. Los intentos fallidos, las visitas públicas a diseños compartidos y el trabajo local sin sincronizar no lo renuevan. La limpieza horaria elimina las cuentas vencidas con sus diseños, croquis y sesiones; también se ejecuta al arrancar tras una interrupción. No hay avisos por correo ni recuperación de cuentas eliminadas.

## Uso sin conexión

La versión de producción guarda la aplicación y sus recursos en un service worker. Puede instalarse como PWA cuando el navegador lo permita y abrirse desde `/designs` sin servidor. Requiere HTTPS o localhost, IndexedDB y Web Locks. Otra pestaña del mismo diseño queda en lectura para evitar escritores simultáneos. El servidor de desarrollo de Vite no registra el service worker; prueba la disponibilidad completa con una compilación de producción.

1. Entra en tu cuenta con conexión y abre **Ajustes → Sin conexión** desde la biblioteca o el editor.
2. Prepara los diseños. Se descargan todos los diseños de tu propiedad sin colaboradores, invitaciones pendientes ni enlace público, sus croquis y modelos y la biblioteca **Mis modelos**. No hace falta visitar el visor ni mostrar cada mueble. El estado sólo confirma disponibilidad cuando todos los recursos del diseño están guardados. Una preparación interrumpida conserva las copias completas existentes y permite reintentar.
3. Activa el modo sin conexión. La elección corresponde a esa cuenta y ese navegador, se comparte entre sus pestañas y persiste al reabrir. Permite crear, importar, editar, modelar y eliminar localmente. No activa colaboración, notificaciones ni sincronización al recuperar internet o enfocar la ventana. Los diseños compartidos ofrecen crear una copia personal independiente mientras exista conexión; no se cambian el original ni sus permisos.
4. Desactiva el modo para sincronizar todos los pendientes, también los diseños cerrados y los modelos todavía no insertados. Se comprueban cuenta, permisos y versiones; las confirmaciones perdidas se reconcilian sin duplicar. Un proyecto nuevo crea primero su registro, después sus modelos y finalmente guarda el diseño y el croquis. El trabajo local se conserva si algún paso falla.

En modo normal, una interrupción de red también permite continuar en los diseños privados disponibles. Un conflicto, un cambio de permisos o la colaboración activada desde otra sesión no sobrescribe otra versión: puedes conservar el servidor, descargar tu paquete completo o recuperar el trabajo como una copia independiente.

Los ajustes muestran el progreso, espacio aproximado, pendientes, instalación y actualizaciones. La aplicación solicita almacenamiento persistente; el navegador puede denegarlo, imponer cuotas o borrar sus datos. Las actualizaciones esperan la confirmación de guardado local de las pestañas abiertas. No se trata de un respaldo externo: conserva exportaciones de lo que necesites.

La sesión del servidor puede vencer sin bloquear el uso y la exportación del trabajo local. Para sincronizar hay que volver a entrar en la misma cuenta; un nombre de usuario reutilizado no hereda los borradores de otra cuenta. Iniciar o cerrar sesión y modificar cuentas o permisos requieren conexión. Cerrar sesión comprueba pendientes antes de limpiar únicamente los datos de esa cuenta; sincroniza o descarga una copia antes de descartarlos. Borrar manualmente los datos del navegador puede perder cambios todavía no enviados.

La sincronización necesita la aplicación abierta y continúa al reabrirla. El trabajo local no renueva los tres meses de actividad en el servidor. El visor público y el iframe muestran la versión del servidor, nunca borradores privados de este dispositivo. Retirar un acceso no puede borrar archivos ya descargados ni dispositivos que sigan desconectados.

## Privacidad

`/privacy` y `/terms` muestran el aviso de privacidad y las condiciones de uso sin exigir una cuenta ni cargar el editor. Son accesibles desde la portada, el acceso, la biblioteca, los ajustes del editor y la preparación de diseños. Los enlaces del acceso, el editor y la preparación abren otra pestaña para conservar formularios y trabajo en curso. Las condiciones describen gratuidad, servicio «tal cual», ausencia de soporte individual, conservación, respaldos y cierre; no excluyen las obligaciones legales ni la atención de solicitudes de privacidad.

La aplicación no incluye analíticas, publicidad, rastreadores ni peticiones automáticas a proveedores externos. El aviso describe los datos mínimos de cuenta y seguridad, el guardado de diseños, las cookies, los enlaces compartidos, la conservación y las solicitudes de derechos. Los datos guardados son accesibles operativamente por la administración del servidor; no hay cifrado extremo a extremo. Los croquis conservan el archivo original y sus metadatos.

No se añade un banner general de aceptación: el acceso normal usa una cookie necesaria de sesión y la persistencia se elige de forma informada en el formulario. La selección nueva se aplica al siguiente acceso; para retirar la elección se cierra sesión y se vuelve a entrar sin recordarla. Si se incorporan cookies de otras finalidades, habrá que revisar el aviso y solicitar la elección correspondiente antes de utilizarlas.

Antes de publicar otra instancia, actualiza `src/Privacy.tsx` y `src/Terms.tsx` con la identidad del responsable, domicilio para notificaciones, contacto, país del servidor y las políticas reales de registros y respaldos. La versión aceptada está en `src/legalPolicy.ts`; cambia su valor al publicar una nueva versión de condiciones que deba aceptarse. La aplicación registra la aceptación durante el alta, no atribuye una aceptación retroactiva a cuentas existentes ni fuerza una nueva aceptación a todas las cuentas al cambiar esa constante: una actualización que la requiera necesita implementar también ese flujo antes de aplicarla. Los registros del proxy y los respaldos externos dependen del operador y no los controla esta aplicación. El aviso no sustituye la revisión de la configuración del servidor o de las obligaciones aplicables en cada jurisdicción.

La configuración publicada corresponde a `3d.adriandomc.com`. Si despliegas otra instancia, reemplaza los datos del responsable y verifica las políticas de tu infraestructura. En esta instalación, revisada el 13 de octubre de 2026, el proxy activo es Caddy: no tiene registro de accesos HTTP habilitado. Los contenedores de la aplicación y del proxy usan `json-file` con rotación de tres archivos de 10 MB; no hay un plazo fijo de conservación en días. Los destinos de Log Drains están desactivados y Sentinel conserva siete días de métricas de estado del servidor. No se modificó esa configuración durante la revisión.

## Uso del editor

- Selecciona paredes, piso, techo, puertas, ventanas, muebles o focos desde **Elementos**, la escena o la planta. Sus medidas y controles aparecen en **Propiedades**.
- El editor empieza con los paneles cerrados. **Elementos**, **Cuarto**, **Materiales** y **Luz** abren el panel correspondiente. En pantallas pequeñas, la barra inferior abre un solo panel flotante; ciérralo para volver al visor. Las opciones adicionales se despliegan al necesitarlas.
- Puedes vaciar los campos mientras escribes. El nombre se confirma al salir del campo o pulsar Enter; las medidas y los códigos completos de color se aplican durante la edición. Enter confirma y Escape descarta el borrador pendiente. Si dejas un valor vacío, incompleto o fuera de sus límites, se conserva el último valor válido. Los decimales admiten punto o coma y mantienen su precisión; las flechas arriba y abajo ajustan las medidas por su paso.
- Usa **Mover** y arrastra el objeto o sus controles de colores. **Girar** rota los muebles. Los muebles pueden atravesar otros objetos, superponerse y salir de la planta sin bloquear el movimiento. Una marca roja translúcida en el visor y la planta señala las posiciones que necesitan ajuste; esas posiciones también se guardan. En **Opciones de vista → Movimiento** (o **Ajustes** en móvil), activa el ajuste a cuadrícula y configura su paso; el giro avanza en 15°. **Ajustar luces al cuarto** limita sólo los focos a la planta. Los límites generales de dimensiones y altura siguen vigentes; el recorrido interior conserva las colisiones.
- Ajusta ancho, fondo, altura y espesor del cuarto; arrastra esquinas para crear una planta irregular.
- Carga un croquis PNG, JPG o WebP y marca sus esquinas en orden. Usa la cuadrícula y **Líneas rectas**, con ángulos de 15°, 30°, 45° o 90°. Toca el primer punto o pulsa Enter para cerrar; Retroceso deshace y Escape cancela. Indica el ancho total en metros para fijar la escala. Al cambiar la planta se conservan las posiciones de los muebles y se reubican las aberturas; si las aberturas no caben, se conserva la planta actual.
- Añade puertas y ventanas desde **Agregar**. Escribe su altura antes de crearlas: no viene preseleccionada y debe caber en el cuarto junto con el antepecho. Las puertas permiten apertura **Derecha**, **Izquierda** o **Sólo marco**, sin hoja. Las puertas nuevas con hoja empiezan cerradas. Arrastra las aberturas hacia otra pared para trasladarlas y ajusta sus medidas en Propiedades. Los huecos se conservan al cambiar dimensiones; si no caben sin superponerse, el cambio se rechaza.
- Selecciona pared, piso o techo en **Materiales**. Escribe o pega un código hexadecimal de tres o seis dígitos, con o sin `#`; puedes copiarlo y reutilizar los colores aplicados al cuarto. El piso admite madera, loseta, loseta trabada, damero, mármol y concreto.
- Añade focos, cambia posición, lúmenes y temperatura de color y utiliza su interruptor. Ajusta también la hora, orientación e intensidad del sol.
- Añade camas individuales, matrimoniales, queen o king, roperos, tocadores y burós. Selecciona un mueble para cambiar sus dimensiones, posición, giro, color y material (madera, plástico o metal), o eliminarlo. El acabado de la estructura responde al modo Estándar, Realista o Hiperrealista; el colchón, la ropa de cama, el espejo y los tiradores conservan sus materiales propios. La planta y el visor muestran exclusivamente los muebles guardados; borrar el último no genera decoración. Cada mueble del catálogo conserva su variante y acabado; un modelo importado puede mantener explícitamente los materiales y colores originales.
- Alterna entre vista exterior, planta y recorrido interior. En escritorio usa WASD o las flechas para caminar, Q/E para girar y R/F para mirar arriba o abajo. En pantallas táctiles mueve el joystick y arrastra para mirar.
- En el recorrido, toca una puerta para abrirla o cerrarla y un foco para encenderlo o apagarlo. También puedes usar el botón que aparece junto al elemento visible, o mirarlo y pulsar Enter o Espacio. Arrastrar para mirar no activa los elementos. La hoja, las sombras y la entrada de luz responden al estado de la puerta. El propietario guarda estos cambios con su diseño; en un enlace de lectura, las interacciones son temporales y no modifican el diseño guardado.

**Estándar** reduce el trabajo gráfico. **Realista** añade relieve de superficies, variación de rugosidad y reflejos. **Hiperrealista** usa materiales PBR fotografiados, tela con volumen y pliegues, iluminación HDR y sombras de contacto. Los activos se sirven desde la aplicación y se cargan al elegir ese modo; suman aproximadamente 9.2 MiB. En pantallas móviles se reduce la resolución y las muestras de los efectos. Los modos más detallados consumen más GPU y batería. El modo elegido queda guardado con el proyecto.

El modo visual se elige en **Opciones de vista → Calidad visual**.

Los activos PBR y el entorno son CC0; su procedencia está documentada en [public/materials/README.md](public/materials/README.md) y [public/environments/README.md](public/environments/README.md). La vista arquitectónica sigue siendo interactiva: las sombras de contacto y la luz indirecta son aproximadas, no un render con trazado de rayos ni una simulación fotométrica.

Las camas parten de medidas nacionales de colchón: individual **1.00 × 1.90 m**, matrimonial **1.35 × 1.90 m**, queen **1.50 × 1.90 m** y king **2.00 × 1.90 m**, según [Sealy México](https://sealy.com.mx/linea-correct-comfort/). Son medidas iniciales editables: ajusta el tamaño si tu colchón, marco o cabecera ocupan más espacio.

El croquis se traza manualmente; no se interpreta con reconocimiento automático. La luz solar es una aproximación controlada por hora y orientación, sin ubicación geográfica, fecha ni cálculo astronómico. Los colores y niveles de luz son una vista previa visual: dependen de la pantalla y no están calibrados para especificar pintura o iluminación real. Los pasillos extremadamente estrechos pueden limitar el recorrido.

## Desarrollo local

Requiere **Node.js 24** y npm. El servidor usa los módulos HTTP y SQLite incluidos en Node; no necesita una base de datos externa.

Desde esta carpeta instala las dependencias y abre el servidor:

```sh
npm ci
npm run dev:server
```

En otra terminal, desde esta misma carpeta:

```sh
npm run dev
```

Abre la dirección que muestra Vite. Sus solicitudes `/api` se envían al servidor en `http://localhost:8080`. Los datos de desarrollo se guardan en `data/accounts.sqlite`; cambiar `DATA_DIR` permite elegir otra carpeta. Para acceder desde otro dispositivo conectado a la misma red utiliza la IP del equipo; habilita HTTPS para probar WebGPU fuera de `localhost`.

Para comprobar y ejecutar la versión de producción:

```sh
npm test
npm run build
npm start
```

`build` comprueba TypeScript y genera `dist/` para el cliente y `server-dist/` para el servidor. `start` sirve la aplicación y su API desde el puerto **8080**, configurable mediante `PORT`. El servidor necesita permiso de escritura en `DATA_DIR`.

Para probar la PWA sobre una compilación de producción:

```sh
npx playwright install chromium webkit
npm run test:e2e
npm run test:e2e:webkit
```

Estas pruebas abren contextos de navegador nuevos y un servidor aislado en `127.0.0.1:5188`, con una base temporal propia; no utilizan `data/` ni producción. Comprueban preparación, arranque sin red, modelos y croquis, creación local, ausencia de tráfico en modo forzado y sincronización al salir. Cada ejecución cierra la base y elimina su directorio temporal. Las capturas y trazas de fallo quedan en `test-results/`. Para usar una instalación local de Chrome puede definirse `PLAYWRIGHT_CHANNEL=chrome`.

## Docker local

Con Docker activo, desde esta carpeta:

```sh
docker build -t virtual-space .
docker run --rm -p 8080:8080 -e NODE_ENV=development -v virtual-space-data:/data virtual-space
```

Abre `http://localhost:8080`. Este comando permite probar las sesiones por HTTP sólo en desarrollo local; en Coolify conserva `NODE_ENV=production` y usa HTTPS. El Dockerfile construye el cliente y servidor y los ejecuta con Node.js 24, usuario sin privilegios y puerto interno **8080**. El volumen `virtual-space-data` conserva la base de datos y croquis al eliminar o reemplazar el contenedor.

## Despliegue en Coolify desde GitHub

El código y el Dockerfile pertenecen al repositorio independiente [adriandomc/virtual-space](https://github.com/adriandomc/virtual-space), en la rama **main** que seguirá Coolify. La aplicación está preparada para desplegarse en la raíz de un dominio.

1. Crea una aplicación desde el repositorio GitHub `adriandomc/virtual-space` y elige la rama `main`.
2. Selecciona **Dockerfile** como método de construcción, usa `/` como **Base Directory** y configura **Dockerfile Location** como `/Dockerfile`.
3. Establece **Ports Exposes** en `8080` y añade tu dominio con HTTPS. El proxy de Coolify recibe el tráfico público y lo dirige a ese puerto interno.
4. En **Persistent Storage**, añade un volumen persistente con destino **`/data`**. Este paso es necesario para conservar los proyectos y croquis entre despliegues. El contenedor usa `DATA_DIR=/data`; si utilizas un montaje de carpeta del host, debe permitir escritura al usuario `node` del contenedor, UID 1000.
5. Despliega y revisa los registros, el estado de salud y la dirección pública. Si quieres redesplegar automáticamente al cambiar `main`, activa los despliegues automáticos de la integración GitHub.

Consulta la [configuración oficial de Dockerfile en Coolify](https://coolify.io/docs/applications/builds/dockerfile) y [su almacenamiento persistente](https://coolify.io/docs/applications/configuration/persistent-storage).

En producción las cookies de sesión son `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` y no tienen `Domain`. Todas las mutaciones exigen un `Origin` que corresponda al sitio. Configura `APP_ORIGIN` con el origen completo del dominio, por ejemplo `https://tudominio.example`, sin ruta; si se omite, se usa el host recibido y el protocolo del proxy autorizado.

`TRUSTED_PROXIES` admite una lista de IPs o CIDRs separados por comas. Ajusta ese valor a la red real del proxy de Coolify —Caddy en esta instalación— para identificar al visitante mediante `X-Forwarded-For`: se recorre la cadena desde la derecha hasta el primer salto no confiable. De forma predeterminada sólo se confían loopback y redes privadas IPv4 habituales de Docker; cabeceras enviadas directamente desde una IP pública se ignoran. Evita publicar el puerto interno `8080` fuera del proxy o confiar indiscriminadamente en las cabeceras recibidas. Con un CDN delante, verifica también la confianza y el tratamiento de sus direcciones en el proxy.

Configura el DNS del dominio hacia el servidor y habilita TLS en Coolify. **HTTPS es necesario para las sesiones y para WebGPU en producción**; los navegadores y GPU compatibles determinan si se usa WebGPU o la alternativa WebGL.

### Reinicio único antes del lanzamiento

El reinicio autorizado de los datos de prueba es una operación manual y destructiva, separada del arranque y de los despliegues normales. Con la aplicación detenida y sin conexiones SQLite, utiliza la imagen exacta de esta versión y el volumen confirmado de 3D Space en un contenedor auxiliar sin red:

```sh
docker run --rm --network none \
  --mount "type=volume,source=${DATA_VOLUME},target=/data" \
  "$APP_IMAGE" \
  node server-dist/operations.js reset-prelaunch /data --confirm=reset-3d-space-test-data
```

La operación comprueba que el directorio contiene únicamente datos reconocidos del servicio, elimina cuentas, diseños, modelos, sesiones y respaldos de prueba, crea el esquema actual vacío y registra `prelaunch-reset.json`. Ese marcador impide repetirla. Un archivo inesperado, enlace simbólico o SQLite todavía abierto hace que se rechace; revisa el motivo sin forzar un borrado general. Después despliega una sola instancia y verifica registro, creación, preparación offline y un respaldo nuevo. Los dispositivos reciben el almacenamiento local nuevo al cargar la aplicación actual; no se importan copias de prueba.

## Respaldos y comprobación de recuperación

El servidor realiza una copia consistente mediante la API de respaldo de SQLite, sin detener las escrituras. Al arrancar y cada hora comprueba el mantenimiento: genera una copia si no hay una válida de las últimas 24 horas, elimina cuentas inactivas y depura los respaldos vencidos. No necesita cron ni un servicio externo. Si la aplicación está detenida no hay tareas; se reanudan al siguiente arranque.

Cada copia se comprueba con `integrity_check`, relaciones de claves foráneas y una comparación del esquema y de **todas las filas y BLOB** contra una restauración temporal independiente. Sólo se publica en `DATA_DIR/backups` tras superar esa comprobación. Una copia reciente dañada no impide intentar otra. Los respaldos se conservan durante 7 días y hasta la siguiente limpieza horaria; una interrupción puede retrasar su eliminación hasta el arranque.

En Linux, el directorio de datos y el de respaldos tienen permisos `0700`; la base, las copias y los archivos operativos tienen permisos `0600`. `DATA_DIR/maintenance-status.json` contiene el resultado y la fecha de la última comprobación; sólo lo consulta la administración desde el servidor, no una ruta pública. Revisa ese estado, los errores del contenedor y el espacio disponible en `/data`. Un error de mantenimiento no se considera un respaldo válido.

Desde la terminal del contenedor de la aplicación puedes solicitar una copia adicional o comprobar una copia concreta. Usa su nombre real, obtenido de `/data/backups`:

```sh
npm run maintenance -- backup /data
npm run maintenance -- verify /data/backups/ARCHIVO_REAL.sqlite
```

Las copias residen en el mismo servidor IONOS en Estados Unidos. Cubren fallos lógicos recuperables mientras ese almacenamiento siga disponible; **no protegen frente a la pérdida total del VPS o su disco**. No hay respaldo externo configurado. Si se incorpora otro destino, hay que asegurar acceso, conservación, eliminaciones y actualizar el aviso antes de utilizarlo.

`DATA_DIR/erasures.json` es un registro separado de eliminaciones y revocaciones: conserva identificadores, fechas y, cuando corresponde, la versión de un croquis, sin su contenido ni contraseñas. Se conserva durante la ventana de recuperación de 7 días y se depura después de borrar las copias vencidas. Es necesario conservar su versión vigente: una restauración la aplica antes de iniciar el servicio para evitar reactivar cuentas, diseños, croquis o enlaces eliminados/revocados. No lo reemplaces con un archivo anterior ni con uno vacío.

### Recuperar una copia sin sobrescribir la base activa

1. Detén la aplicación desde Coolify y confirma que terminó. No basta con quitar el dominio. No debe haber otro proceso usando la base ni archivos SQLite de recuperación activos (`-wal`, `-shm` o `-journal`). No borres esos archivos manualmente para forzar una operación.
2. Confirma la **imagen exacta** de la aplicación desplegada y el almacenamiento que Coolify monta en `/data`. Conserva el respaldo elegido y el registro **vigente** de eliminaciones. La copia debe tener el nombre generado por la aplicación y menos de 7 días; una copia vencida se rechaza aunque haya sido guardada fuera de `/data/backups`.
3. Usa un contenedor auxiliar de una sola ejecución, con esa misma imagen, sin servidor HTTP ni red. Monta los datos existentes en `/data` y una carpeta de recuperación vacía y escribible por UID 1000 en `/recovery`. El destino final `/recovery/restored` **no debe existir**; su carpeta padre sí. No ejecutes una segunda instancia de la aplicación sobre el mismo almacenamiento.

Ejemplo para un volumen Docker: sustituye las variables por valores confirmados en tu servidor. Si Coolify usa una carpeta del host, usa un montaje `type=bind` para ese origen en vez de un volumen. No se debe adivinar el nombre del volumen ni de la imagen.

```sh
APP_IMAGE='IMAGEN_EXACTA_DESPLEGADA'
DATA_VOLUME='VOLUMEN_REAL_MONTADO_EN_DATA'
RECOVERY_PARENT='/RUTA_ABSOLUTA_EXISTENTE_DE_RECUPERACION'
BACKUP_FILE='ARCHIVO_REAL.sqlite'

docker run --rm --network none \
  --mount "type=volume,source=${DATA_VOLUME},target=/data,readonly" \
  --mount "type=bind,source=${RECOVERY_PARENT},target=/recovery" \
  "$APP_IMAGE" \
  node server-dist/maintenance.js restore \
  "/data/backups/${BACKUP_FILE}" /recovery/restored /data/erasures.json
```

La herramienta verifica la copia, la restaura en el destino nuevo, compara de nuevo todos los datos y aplica el registro vigente de eliminaciones y el vencimiento por inactividad. También revoca todas las sesiones recuperadas: los usuarios deben volver a iniciar sesión. El resultado JSON distingue la comprobación de la copia original y el estado resultante tras estas depuraciones; no se espera que reaparezcan datos que fueron eliminados después del respaldo.

4. Revisa el resultado y realiza una prueba aislada con usuarios y diseños de prueba antes de sustituir almacenamiento de producción. Mantén la aplicación de Coolify detenida hasta que el destino seleccionado sea correcto.
5. Configura en Coolify la carpeta recuperada como almacenamiento persistente de `/data`, con `DATA_DIR=/data`, y arranca **una sola instancia**. Comprueba acceso, diseños, croquis, privacidad y estado de mantenimiento. Conserva el registro de eliminaciones que la herramienta copió junto con la base restaurada.
6. Los datos originales, carpetas de ensayo o copias adicionales creadas manualmente no se depuran automáticamente. Elimina esas copias de manera controlada cuando termine la comprobación, respetando el plazo publicado de conservación. No borres el almacenamiento que utiliza la instancia activa.

`verify` realiza una restauración temporal automática en cada ejecución. Las pruebas del repositorio cubren recuperación completa y rechazo de copias dañadas, vencidas, rutas inseguras y destinos existentes. Una restauración comprobada no garantiza recuperar cambios posteriores al respaldo.

### Cancelación de una cuenta

Confirma primero la solicitud y la titularidad conforme al aviso de privacidad. Con la aplicación **detenida** y usando la imagen y volumen reales como arriba, ejecuta el contenedor auxiliar con permiso de escritura:

```sh
docker run --rm --network none \
  --mount "type=volume,source=${DATA_VOLUME},target=/data" \
  "$APP_IMAGE" \
  node server-dist/operations.js cancel-account /data USUARIO --confirm=USUARIO
```

Sustituye ambos `USUARIO` por el mismo usuario normalizado en minúsculas. La herramienta elimina la cuenta con sus diseños, croquis y sesiones, registra la eliminación para futuras restauraciones y compacta SQLite. Las copias previas pueden conservar datos residuales hasta su vencimiento. Reinicia la aplicación y verifica la operación sin registrar contenido privado en capturas o logs.

### Cierre definitivo del servicio

Este procedimiento es destructivo y **sólo corresponde a un cierre definitivo**, no a mantenimiento, despliegues o una prueba de restauración. Cuando sea posible, publica antes un aviso para que los usuarios exporten sus diseños. Detén la aplicación en Coolify, desactiva los despliegues automáticos y confirma la imagen y el volumen objetivo. Un cierre seguido de un arranque volvería a crear una base vacía.

Con el mismo contenedor auxiliar offline y montaje escribible, el comando de cierre es:

```sh
docker run --rm --network none \
  --mount "type=volume,source=${DATA_VOLUME},target=/data" \
  "$APP_IMAGE" \
  node server-dist/operations.js close-service /data --confirm=erase-all
```

La herramienta comprueba que la base pertenece a 3D Space, elimina sus cuentas y datos asociados, y retira la base, respaldos reconocidos, registro de eliminaciones y estado de mantenimiento. Rechaza enlaces simbólicos, una raíz del sistema, archivos SQLite activos o archivos inesperados en la carpeta de respaldos; revisa la causa en vez de forzar un borrado general.

Finalmente retira la aplicación y su almacenamiento de Coolify. Revisa por separado cualquier volumen antiguo, carpeta de recuperación, copia externa, archivo manual, registros de infraestructura y mensajes de contacto que hayas conservado: el comando sólo alcanza los archivos conocidos del directorio indicado. Elimina o restringe lo que corresponda según las obligaciones legales y confirma que no queda ninguna instancia capaz de volver a exponer los datos. La eliminación operativa no garantiza un borrado físico inmediato de cada sector del disco ni alcanza copias descargadas por terceros.
