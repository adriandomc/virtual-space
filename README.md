# virtual-space · Espacio, visualizador de cuartos

Aplicación React + TypeScript + Three.js para construir la planta de un cuarto, elegir colores de pared y recorrerlo en 3D. Usa materiales TSL y el renderizador WebGPU de Three.js, con alternativa WebGL cuando el dispositivo no ofrece WebGPU. Un servidor Node.js guarda cada proyecto y su croquis en SQLite.

## Proyectos guardados y enlaces

Cada proyecto tiene un enlace de edición privado. Los cambios se guardan automáticamente en el servidor: dimensiones, contorno, colores, puertas, ventanas, focos e interruptores, sol, muebles y su visibilidad. La imagen del croquis también queda guardada en el proyecto. Espera a que el estado indique que se guardó antes de cerrar la página o compartirla.

Guarda tu dirección completa de edición como marcador. Contiene `?room=<identificador>#edit=<clave>`; la clave permite modificar ese proyecto. Quien obtenga ese enlace privado puede editarlo. Si pierdes la clave, no hay un inicio de sesión que permita recuperarla.

El botón **Compartir** copia una dirección de consulta sin la clave: `?room=<identificador>`. Otra persona puede abrirla desde otro dispositivo y ver el mismo proyecto guardado, incluido el croquis, y navegar la escena en modo de solo lectura. No recibe permisos de edición. Quien tenga el enlace de consulta puede ver el proyecto.

Los datos se conservan en el servidor, sin depender del almacenamiento local del navegador. La exportación JSON permite respaldar los parámetros del cuarto; el respaldo completo de los proyectos y croquis se hace desde el volumen de datos del servidor.

## Uso del editor

- Ajusta ancho, fondo, altura y espesor del cuarto; arrastra esquinas para crear una planta irregular. Selecciona cada pared para cambiar su pintura.
- Carga un croquis PNG, JPG o WebP y marca sus esquinas en orden. Indica el ancho total trazado en metros para fijar la escala y aplica el contorno. Reemplazar la planta elimina las puertas y ventanas anteriores; el editor avisa antes de aplicarla.
- Añade puertas y ventanas a una pared y ajusta su ancho, altura, posición y antepecho. Los huecos se conservan al cambiar dimensiones; si no caben sin superponerse, el cambio se rechaza.
- Añade focos, cambia posición, lúmenes y temperatura de color y utiliza su interruptor. Ajusta también la hora, orientación e intensidad del sol.
- Añade camas individuales, matrimoniales, queen o king, roperos, tocadores y burós. Selecciona un mueble para cambiar sus dimensiones, posición y giro, o eliminarlo. La planta y el visor muestran los mismos muebles guardados; el enlace de consulta conserva su distribución.
- Alterna entre vista exterior, planta y recorrido interior. En escritorio usa WASD o las flechas para caminar, Q/E para girar y R/F para mirar arriba o abajo. En pantallas táctiles mueve el joystick y arrastra para mirar.

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

Abre la dirección que muestra Vite. Sus solicitudes `/api` se envían al servidor en `http://localhost:8080`. Los datos de desarrollo se guardan en `data/rooms.sqlite`; cambiar `DATA_DIR` permite elegir otra carpeta. Para acceder desde otro dispositivo conectado a la misma red utiliza la IP del equipo; habilita HTTPS para probar WebGPU fuera de `localhost`.

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
docker run --rm -p 8080:8080 -v virtual-space-data:/data virtual-space
```

Abre `http://localhost:8080`. El Dockerfile construye el cliente y servidor y los ejecuta con Node.js 24, usuario sin privilegios y puerto interno **8080**. El volumen `virtual-space-data` conserva la base de datos y croquis al eliminar o reemplazar el contenedor.

## Despliegue en Coolify desde GitHub

El código y el Dockerfile pertenecen al repositorio independiente [adriandomc/virtual-space](https://github.com/adriandomc/virtual-space), en la rama **main** que seguirá Coolify. La aplicación está preparada para desplegarse en la raíz de un dominio.

1. Crea una aplicación desde el repositorio GitHub `adriandomc/virtual-space` y elige la rama `main`.
2. Selecciona **Dockerfile** como método de construcción, usa `/` como **Base Directory** y configura **Dockerfile Location** como `/Dockerfile`.
3. Establece **Ports Exposes** en `8080` y añade tu dominio con HTTPS. El proxy de Coolify recibe el tráfico público y lo dirige a ese puerto interno.
4. En **Persistent Storage**, añade un volumen persistente con destino **`/data`**. Este paso es necesario para conservar los proyectos y croquis entre despliegues. El contenedor usa `DATA_DIR=/data`; si utilizas un montaje de carpeta del host, debe permitir escritura al usuario `node` del contenedor, UID 1000.
5. Despliega y revisa los registros, el estado de salud y la dirección pública. Si quieres redesplegar automáticamente al cambiar `main`, activa los despliegues automáticos de la integración GitHub.

Consulta la [configuración oficial de Dockerfile en Coolify](https://coolify.io/docs/applications/builds/dockerfile) y [su almacenamiento persistente](https://coolify.io/docs/applications/configuration/persistent-storage).

Configura el DNS del dominio hacia el servidor y habilita TLS en Coolify. **HTTPS es necesario para WebGPU en producción**; los navegadores y GPU compatibles determinan si se usa WebGPU o la alternativa WebGL.

Respalda periódicamente el volumen `/data`. Para un respaldo consistente de SQLite, detén la aplicación antes de copiar la carpeta completa; así también conservas los archivos auxiliares que pudiera necesitar la base de datos.
