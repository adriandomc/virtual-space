# 3D Space

Aplicación React + TypeScript + Three.js para construir la planta de un cuarto, elegir colores de pared y recorrerlo en 3D. Usa materiales TSL y el renderizador WebGPU de Three.js, con alternativa WebGL cuando el dispositivo no ofrece WebGPU. Un servidor Node.js guarda cada proyecto y su croquis en SQLite.

## Cuentas y diseños

La portada `/` muestra tres demos interactivos: vista del cuarto, edición de un ropero y recorrido interior. Los demos funcionan sin cuenta y sus cambios son temporales. `/login` permite entrar o crear una cuenta; `/designs` abre la biblioteca y `/editor?room=<identificador>` abre un diseño. Durante la preparación se añade `&setup=1` a esa dirección.

El acceso sólo necesita usuario y contraseña. El usuario se normaliza en minúsculas, admite de 3 a 32 letras ASCII, números o guiones bajos. La contraseña admite de 8 a 128 caracteres y se confirma al registrarse. No hay correo ni recuperación automática de contraseñas. La aplicación no tiene pagos ni suscripciones.

**Mis diseños** permite crear, abrir y eliminar diseños propios. Las modificaciones y el croquis se guardan automáticamente en el servidor. Espera a que el estado indique que se guardó antes de cerrar la página. Sólo el propietario puede editar o eliminar su diseño.

**Nuevo diseño** abre una preparación aparte del editor: **Croquis → Colores → Decoración**. Cada paso permite continuar, volver u omitirlo. Los diseños nuevos empiezan sin muebles, puertas ni ventanas, con una sola luz principal encendida. Omitir Croquis conserva la estructura normal de 5 × 4 m; omitir Colores deja paredes, techo y piso en blancos; omitir Decoración conserva sólo la luz principal. Puedes trazar o cargar la planta, ajustar medidas, elegir acabados y añadir muebles, aberturas o focos antes de entrar al editor. Las decisiones y el paso actual se guardan en el servidor; **Continuar preparación** en la biblioteca permite retomarlo. Entrar al editor espera a que se guarden los cambios.

Los diseños son privados inicialmente. **Compartir → Crear enlace** habilita una dirección de lectura `/editor?room=<identificador>`: quien reciba ese enlace puede ver el diseño y su croquis, y recorrerlo sin iniciar sesión. **Desactivar enlace** revoca ese acceso. El enlace no concede permisos de edición.

Las cuentas, sesiones, diseños, croquis y contadores de seguridad se guardan en `/data/accounts.sqlite`. La base anterior `rooms.sqlite` no se lee ni se migra; se inicia el sistema de cuentas desde cero. Las contraseñas se guardan con scrypt y sal aleatoria; los tokens de sesión sólo se guardan como hashes. El token de sesión vence como máximo a los 30 días y se revoca al cerrar sesión. La cookie es de sesión por defecto; sólo se conserva durante 30 días si el usuario marca **Recordar sesión 30 días (usa cookies)** al entrar o registrarse. Esta opción está desmarcada inicialmente y se valida también en el servidor.

Los límites persisten tras reinicios: 5 intentos de acceso por usuario/IP en 15 minutos, 30 intentos totales por IP en ese intervalo y bloqueo progresivo tras 10 fallos, de 15 minutos hasta 24 horas. Se agrupan direcciones IPv6 por `/64`. El registro se limita a 5 cuentas por IP/hora; también hay límites de peticiones, creación de diseños y cargas. La derivación de contraseñas limita su concurrencia para mantener controlado el uso de memoria. Los límites de una IP no bloquean globalmente una cuenta.

Los datos se conservan en el servidor, sin depender del almacenamiento local del navegador. La exportación JSON permite respaldar los parámetros del cuarto; el respaldo completo de los proyectos y croquis se hace desde el volumen de datos del servidor.

## Privacidad

`/privacy` muestra el aviso público sin exigir una cuenta ni cargar el editor. Es accesible desde la portada, el acceso, la biblioteca, los ajustes del editor y la preparación de diseños. Los enlaces del editor y la preparación abren otra pestaña para conservar el trabajo en curso.

La aplicación no incluye analíticas, publicidad, rastreadores ni peticiones automáticas a proveedores externos. El aviso describe los datos mínimos de cuenta y seguridad, el guardado de diseños, las cookies, los enlaces compartidos, la conservación y las solicitudes de derechos. Los datos guardados son accesibles operativamente por la administración del servidor; no hay cifrado extremo a extremo. Los croquis conservan el archivo original y sus metadatos.

No se añade un banner general de aceptación: el acceso normal usa una cookie necesaria de sesión y la persistencia se elige de forma informada en el formulario. La selección nueva se aplica al siguiente acceso; para retirar la elección se cierra sesión y se vuelve a entrar sin recordarla. Si se incorporan cookies de otras finalidades, habrá que revisar el aviso y solicitar la elección correspondiente antes de utilizarlas.

Antes de publicar el aviso, completa `details` en `src/Privacy.tsx` con la identidad del responsable, domicilio para notificaciones, contacto, país del servidor y las políticas reales de registros y respaldos. Mientras esos campos estén vacíos, la página se identifica como un borrador. Los registros de acceso de Coolify y su proxy, y los respaldos, dependen del operador: no se desactivan ni se borran desde esta aplicación. El aviso no sustituye la revisión de la configuración del servidor o de las obligaciones aplicables en cada jurisdicción.

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
- Añade camas individuales, matrimoniales, queen o king, roperos, tocadores y burós. Selecciona un mueble para cambiar sus dimensiones, posición, giro, color y material (madera, plástico o metal), o eliminarlo. El acabado de la estructura responde al modo Estándar, Realista o Hiperrealista; el colchón, la ropa de cama, el espejo y los tiradores conservan sus materiales propios. La planta y el visor muestran los mismos muebles guardados; el enlace de consulta conserva su distribución y acabados. Los proyectos anteriores mantienen sus colores originales hasta editarlos.
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

`TRUSTED_PROXIES` admite una lista de IPs o CIDRs separados por comas. Ajusta ese valor a la red real de Traefik/Coolify para identificar al visitante mediante `X-Forwarded-For`: se recorre la cadena desde la derecha hasta el primer salto no confiable. De forma predeterminada sólo se confían loopback y redes privadas IPv4 habituales de Docker; cabeceras enviadas directamente desde una IP pública se ignoran. Evita publicar el puerto interno `8080` fuera del proxy o activar la confianza indiscriminada de cabeceras de Traefik. Con un CDN delante, la confianza de sus direcciones debe configurarse también en Traefik. [Referencia de cabeceras confiables](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/#forwarded-headers).

Configura el DNS del dominio hacia el servidor y habilita TLS en Coolify. **HTTPS es necesario para las sesiones y para WebGPU en producción**; los navegadores y GPU compatibles determinan si se usa WebGPU o la alternativa WebGL.

Respalda periódicamente el volumen `/data`. Para un respaldo consistente de SQLite, detén la aplicación antes de copiar la carpeta completa; así también conservas los archivos auxiliares que pudiera necesitar la base de datos.
