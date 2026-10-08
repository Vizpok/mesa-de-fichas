# Mesa de fichas

Administrador de fichas y apuestas para jugar poker **en persona**. Las cartas se juegan en la mesa, físicas. La app sólo lleva los **puntos ficticios**: fichas de cada quien, turnos, ciegas, apuestas, botes (con botes laterales) y quién ganó. No reparte cartas ni evalúa manos, y no mueve dinero.

## Qué hace

**Dos formas de jugar**

- **Crear sala / entrar con código.** Cada quien usa su celular. La sala tiene un código de 4 letras. Entras con tu alias y un ícono, y puedes salir y volver a entrar en cualquier momento (tu asiento se conserva).
- **Un solo celular.** Un teléfono lleva toda la mesa: pasa el turno de uno en uno y registra lo que dice cada quien. No necesita internet una vez cargada la app.
- Un host puede crear la sala **sin sentarse** (sólo administra) y agregar jugadores que no tienen celular.

**Dos vistas**

- **Mi mano** (o **Turno** en modo un celular): tus fichas dibujadas con su valor, cuánto llevas apostado, cuánto falta para igualar, el bote, y botones grandes: Retirarse, Pasar / Igualar, Subir o Apostar, All-in.
- **Mesa:** bote, ronda (Preflop, Flop, Turn, River), botes laterales, todos los jugadores con su estado y a quién le toca.

**Una partida normal**

- Botón de dealer que rota solo, ciega pequeña y grande, ante opcional, ciegas que suben cada N manos.
- Heads-up (2 jugadores) con las reglas correctas de ciegas y orden de turno.
- Subida mínima, all-in corto que no reabre la acción, apuesta sin igualar que se devuelve sola.
- Botes laterales con varios all-in. Si ganan varios, o hay empate, se reparten y el residuo va al primero a la izquierda del botón.
- **Al terminar la mano, el dealer (quien tiene el botón) marca al ganador de cada bote.** El host también puede, y puede cambiarse a "sólo el host" en los ajustes.
- Reloj opcional por turno (si se acaba, pasa o se retira solo).
- Recompra al quedarse sin fichas, sentarse fuera, levantarse de la mesa, sacar a alguien.
- Corregir o dar fichas, cambiar el orden de la mesa, poner el botón en otra persona, pasar el mando de host.
- **Deshacer** la última acción (incluso un reparto equivocado).
- Historial de la mesa y resultado final con ganancia de cada quien.
- Si el host se desconecta más de 45 segundos, otro jugador puede tomar el mando.
- El celular vibra cuando es tu turno y la pantalla no se apaga mientras juegas.

## Cómo correrla

Necesitas [Node.js](https://nodejs.org) 18 o más nuevo.

```
npm install
npm start
```

Abre `http://localhost:3000`. En la consola también salen las direcciones de tu red local (por ejemplo `http://192.168.1.20:3000`); los demás celulares abren esa dirección y entran con el código.

Ojo: el wifi de la universidad suele **aislar los dispositivos** entre sí, y entonces los celulares no verán tu computadora. Tienes dos salidas: conectar todos al hotspot de un celular, o publicar la app en internet (siguiente sección). El modo de un solo celular no tiene este problema.

## Publicarla gratis en internet

Cualquier servicio que corra Node con WebSockets sirve (Render, Fly.io, Railway). Con Render: sube esta carpeta a un repositorio de GitHub, elige **New > Blueprint** y apunta al repositorio (usa `render.yaml`). Te da una dirección `https://...onrender.com` que se comparte con todos. Con HTTPS la app se puede **instalar** en la pantalla de inicio (Android: menú de Chrome > Instalar app; iPhone: Compartir > Agregar a inicio).

Los planes gratis se duermen tras un rato sin uso (la primera visita tarda unos segundos) y al reiniciar se pierden las salas abiertas. Para una noche de juego no importa.

## Pruebas

```
npm test        # motor de apuestas (33) y servidor (19)
npm run test:ui # interfaz en un navegador real con Playwright (22); requiere tener playwright instalado
```

## Archivos

- `public/engine.js`: motor de fichas y apuestas. Se usa igual en el servidor y en el navegador.
- `server.js`: servidor de salas (HTTP estático y WebSocket). Una sola dependencia: `ws`.
- `public/app.js`, `styles.css`, `index.html`: la interfaz.
- `public/sw.js`, `manifest.webmanifest`, íconos: para instalarla y usarla sin conexión.
- `tools/make-icons.py`: regenera los íconos.

## App de Android (APK)

Cada vez que se sube un cambio a `main`, GitHub compila el APK solo (pestaña **Actions** → "APK de Android") y lo deja en **Releases** → `Mesa de fichas (Android)`.

1. En el celular, abre la página de Releases del repositorio y descarga `mesa-de-fichas.apk`.
2. Ábrelo. Si Android lo pide, permite instalar apps de ese origen (es un APK de prueba, no viene de la tienda).
3. **Un solo celular** funciona sin internet. Las **salas en línea** usan por defecto el servidor de `public/config.js` (`mesa-de-fichas.onrender.com`, en Render). Se puede cambiar desde *Servidor de las salas* en el inicio, por ejemplo a `192.168.1.20:3000` si es una computadora de la misma red.
4. El plan gratis de Render duerme el servidor tras un rato sin uso: la primera conexión puede tardar hasta un minuto.

El proyecto de Android se genera en la compilación (carpeta `android-app/`, con Capacitor); no hace falta Android Studio.
