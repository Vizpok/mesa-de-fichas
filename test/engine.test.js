const assert = require('assert');
const E = require('../public/engine.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); }
}

function mk(names, settings) {
  const tb = new E.Table();
  if (settings) assert(tb.setSettings(settings).ok);
  const ids = {};
  names.forEach(n => { const r = tb.addPlayer({ name: n, id: n }); assert(r.ok, r.error); ids[n] = n; });
  return tb;
}
const stack = (tb, id) => tb.player(id).stack;
const totalChips = tb => tb.players.reduce((a, p) => a + p.stack, 0) + (tb.phase === 'betting' || tb.phase === 'showdown' ? E.potTotal(tb) : 0);
function act(tb, id, type, amt) { const r = tb.act(id, type, amt); assert(r.ok, id + ' ' + type + ': ' + r.error); }

console.log('Motor — heads-up');
t('heads-up: dealer es SB y actúa primero preflop', () => {
  const tb = mk(['A', 'B']);
  assert(tb.startHand().ok);
  const h = tb.hand;
  assert.strictEqual(h.sbId, h.dealerId);
  assert.strictEqual(h.toAct, h.dealerId);
  assert.strictEqual(stack(tb, h.sbId), 990);
  assert.strictEqual(stack(tb, h.bbId), 980);
});
t('heads-up: postflop actúa primero el BB', () => {
  const tb = mk(['A', 'B']);
  tb.startHand();
  const h = tb.hand, sb = h.sbId, bb = h.bbId;
  act(tb, sb, 'call'); act(tb, bb, 'check');
  assert.strictEqual(h.street, 1);
  assert.strictEqual(h.toAct, bb);
});
t('heads-up: el BB tiene opción de subir tras el limp', () => {
  const tb = mk(['A', 'B']);
  tb.startHand();
  const h = tb.hand;
  act(tb, h.sbId, 'call');
  assert.strictEqual(h.toAct, h.bbId);
  const L = E.legal(tb, h.bbId);
  assert(L.canCheck && L.canRaise);
});

console.log('Motor — 3 jugadores y rondas');
t('3 jugadores: orden de ciegas y UTG', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  const h = tb.hand;
  assert.deepStrictEqual([h.dealerId, h.sbId, h.bbId], ['A', 'B', 'C']);
  assert.strictEqual(h.toAct, 'A'); // UTG = botón con 3
});
t('ronda completa con igualadas avanza calles y reparte', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  act(tb, 'A', 'call'); act(tb, 'B', 'call'); act(tb, 'C', 'check');
  assert.strictEqual(tb.hand.street, 1);
  assert.strictEqual(E.potTotal(tb), 60);
  // postflop: primero SB (B)
  assert.strictEqual(tb.hand.toAct, 'B');
  act(tb, 'B', 'check'); act(tb, 'C', 'check'); act(tb, 'A', 'check');
  assert.strictEqual(tb.hand.street, 2);
  act(tb, 'B', 'check'); act(tb, 'C', 'check'); act(tb, 'A', 'check');
  assert.strictEqual(tb.hand.street, 3);
  act(tb, 'B', 'check'); act(tb, 'C', 'check'); act(tb, 'A', 'check');
  assert.strictEqual(tb.phase, 'showdown');
  assert(tb.resolve([['C']]).ok);
  assert.strictEqual(tb.phase, 'between');
  assert.strictEqual(stack(tb, 'C'), 1040);
  assert.strictEqual(stack(tb, 'A'), 980);
  assert.strictEqual(totalChips(tb), 3000);
});
t('todos se retiran: gana el último sin showdown', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  act(tb, 'A', 'fold'); act(tb, 'B', 'fold');
  assert.strictEqual(tb.phase, 'between');
  assert.strictEqual(stack(tb, 'C'), 1010);
  assert.strictEqual(totalChips(tb), 3000);
});
t('subir exige mínimo y reabre la acción', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  let r = tb.act('A', 'raise', 30);
  assert(!r.ok, 'debería rechazar subir a 30 (mín 40)');
  act(tb, 'A', 'raise', 60);
  assert.strictEqual(tb.hand.currentBet, 60);
  assert.strictEqual(tb.hand.minRaise, 40);
  act(tb, 'B', 'call'); act(tb, 'C', 'raise', 100);
  assert.strictEqual(tb.hand.toAct, 'A');
  act(tb, 'A', 'call'); act(tb, 'B', 'fold');
  assert.strictEqual(tb.hand.street, 1);
  assert.strictEqual(E.potTotal(tb), 100 + 100 + 60);
});
t('no se puede pasar si hay apuesta ni igualar sin apuesta', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  assert(!tb.act('A', 'check').ok);
  act(tb, 'A', 'call'); act(tb, 'B', 'call'); act(tb, 'C', 'check');
  assert(!tb.act('B', 'call').ok);
  assert(!tb.act('A', 'check').ok); // no es su turno
});
t('turno fuera de orden se rechaza', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  assert(!tb.act('B', 'call').ok);
});

console.log('Motor — all-in y botes laterales');
t('all-in corto no reabre la subida', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.setStack('C', 70);
  tb.startHand();
  // C es BB (postea 20, le quedan 50). A sube a 60, B iguala, C all-in 70 (sube 10 < min 40)
  act(tb, 'A', 'raise', 60); act(tb, 'B', 'call');
  act(tb, 'C', 'allin');
  assert.strictEqual(tb.hand.currentBet, 70);
  assert.strictEqual(tb.hand.minRaise, 40); // no cambia
  assert.strictEqual(tb.hand.toAct, 'A');
  const L = E.legal(tb, 'A');
  assert(!L.canRaise, 'A ya actuó y no puede resubir ante all-in corto');
  assert.strictEqual(L.toCall, 10);
});
t('un all-in no obliga a nadie a ir all-in: se puede igualar con menos o retirarse', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.setStack('A', 100); tb.setStack('B', 1000); tb.setStack('C', 1000);
  tb.startHand();
  const h = tb.hand;
  while (h.toAct !== 'A' && !h.allIn.A) act(tb, h.toAct, 'fold');
  if (h.allIn.A || h.folded.A) return; // A quedó fuera por las ciegas: no aplica
  act(tb, 'A', 'allin');
  const next = h.toAct, L = E.legal(tb.snapshot(), next);
  assert(L.turn && L.canCall && !L.callAllIn, 'igualar 100 no deja al otro sin fichas');
  act(tb, next, 'call');
  assert(stack(tb, next) > 800, 'sólo puso lo necesario para igualar');
});
t('botes laterales: 3 all-in distintos', () => {
  const tb = mk(['A', 'B', 'C', 'D']);
  tb.setStack('A', 100); tb.setStack('B', 300); tb.setStack('C', 600); tb.setStack('D', 600);
  tb.startHand();
  const h = tb.hand;
  // dealer A, SB B, BB C, UTG D
  act(tb, 'D', 'raise', 600);   // all-in 600
  act(tb, 'A', 'allin');        // 100
  act(tb, 'B', 'allin');        // 300
  act(tb, 'C', 'call');         // 600
  assert.strictEqual(tb.phase, 'showdown');
  const pots = h.pots;
  assert.strictEqual(pots.length, 3);
  assert.strictEqual(pots[0].amount, 400);   // 100x4
  assert.strictEqual(pots[1].amount, 600);   // 200x3
  assert.strictEqual(pots[2].amount, 600);   // 300x2
  assert.deepStrictEqual(pots[0].eligible.sort(), ['A', 'B', 'C', 'D']);
  assert.deepStrictEqual(pots[1].eligible.sort(), ['B', 'C', 'D']);
  assert.deepStrictEqual(pots[2].eligible.sort(), ['C', 'D']);
  assert(tb.resolve([['A'], ['B'], ['C']]).ok);
  assert.strictEqual(stack(tb, 'A'), 400);
  assert.strictEqual(stack(tb, 'B'), 600);
  assert.strictEqual(stack(tb, 'C'), 600);
  assert.strictEqual(stack(tb, 'D'), 0);
  assert.strictEqual(totalChips(tb), 1600);
});
t('apuesta sin igualar se devuelve sola', () => {
  const tb = mk(['A', 'B']);
  tb.setStack('A', 500); tb.setStack('B', 100);
  tb.startHand();
  const h = tb.hand;
  act(tb, h.dealerId === 'A' ? 'A' : 'B', 'allin');
  const other = h.toAct;
  act(tb, other, 'call');
  assert.strictEqual(tb.phase, 'showdown');
  // pots: principal 200 (100+100) + devolución 400 de A (sin igualar)
  const pots = tb.hand.pots;
  assert.strictEqual(pots.length, 2);
  assert(pots[1].auto);
  assert(tb.resolve([['B']]).ok);
  assert.strictEqual(stack(tb, 'B'), 200);
  assert.strictEqual(stack(tb, 'A'), 400);
});
t('todos all-in: salta directo a showdown', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  act(tb, 'A', 'allin'); act(tb, 'B', 'allin'); act(tb, 'C', 'allin');
  assert.strictEqual(tb.phase, 'showdown');
  assert(tb.hand.runout);
  assert.strictEqual(E.potTotal(tb), 3000);
  assert(tb.resolve([['B']]).ok);
  assert.strictEqual(stack(tb, 'B'), 3000);
});
t('uno all-in y el resto sigue apostando entre sí', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.setStack('A', 100);
  tb.startHand();
  act(tb, 'A', 'allin'); // 100
  act(tb, 'B', 'call'); act(tb, 'C', 'call');
  assert.strictEqual(tb.hand.street, 1);
  assert.strictEqual(tb.hand.toAct, 'B');
  assert(!E.legal(tb, 'A').turn);
  act(tb, 'B', 'raise', 200); act(tb, 'C', 'call');
  // sigue hasta river con B y C; A está all-in
  ['B', 'C'].forEach(() => {});
  act(tb, 'B', 'check'); act(tb, 'C', 'check'); // turn
  act(tb, 'B', 'check'); act(tb, 'C', 'check'); // river
  assert.strictEqual(tb.phase, 'showdown');
  const pots = tb.hand.pots;
  assert.strictEqual(pots.length, 2);
  assert.strictEqual(pots[0].amount, 300);
  assert.strictEqual(pots[1].amount, 400);
  assert(tb.resolve([['A'], ['B']]).ok);
  assert.strictEqual(stack(tb, 'A'), 300);
  assert.strictEqual(totalChips(tb), 2100); // A empezó con 100, los otros con 1000
});
t('retirado que puso más fichas no gana botes laterales pero sus fichas se quedan', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.setStack('A', 100);
  tb.startHand();
  act(tb, 'A', 'allin'); act(tb, 'B', 'raise', 300); act(tb, 'C', 'call');
  act(tb, 'B', 'check'); act(tb, 'C', 'raise', 200); act(tb, 'B', 'fold');
  assert.strictEqual(tb.phase, 'showdown');
  // C vs A: C elegible en todo, A sólo en principal
  const pots = tb.hand.pots;
  assert.strictEqual(pots[0].eligible.length, 2);
  assert(tb.resolve([['A']]).ok);
  assert.strictEqual(totalChips(tb), 2100); // A empezó con 100, los otros con 1000
});
t('empate: se reparte y el residuo va al primero a la izquierda del botón', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  act(tb, 'A', 'call'); act(tb, 'B', 'call'); act(tb, 'C', 'check');
  for (let i = 0; i < 3; i++) { act(tb, 'B', 'check'); act(tb, 'C', 'check'); act(tb, 'A', 'check'); }
  tb.resolve([['A', 'B']]); // bote 60 → 30 y 30; ambos pusieron 20
  assert.strictEqual(stack(tb, 'A'), 1010);
  assert.strictEqual(stack(tb, 'B'), 1010);
  const tb2 = mk(['A', 'B', 'C'], { smallBlind: 5, bigBlind: 10 });
  tb2.startHand();
  act(tb2, 'A', 'raise', 25); act(tb2, 'B', 'call'); act(tb2, 'C', 'call');
  for (let i = 0; i < 3; i++) { act(tb2, 'B', 'check'); act(tb2, 'C', 'check'); act(tb2, 'A', 'check'); }
  // bote 75 entre 2 → 38/37; residuo para el más cercano a la izquierda del botón (B)
  tb2.resolve([['A', 'B']]);
  assert.strictEqual(stack(tb2, 'B'), 1000 - 25 + 38);
  assert.strictEqual(stack(tb2, 'A'), 1000 - 25 + 37);
  assert.strictEqual(totalChips(tb2), 3000);
});

console.log('Motor — manos sucesivas, botón, ciegas');
t('el botón rota y salta a los que están sentados fuera o sin fichas', () => {
  const tb = mk(['A', 'B', 'C', 'D']);
  tb.startHand();
  assert.strictEqual(tb.dealerId, 'A');
  act(tb, 'D', 'fold'); act(tb, 'A', 'fold'); act(tb, 'B', 'fold');
  tb.sitOut('B', true);
  tb.startHand();
  assert.strictEqual(tb.dealerId, 'C'); // B fuera
  assert(!tb.hand.order.includes('B'));
});
t('setDealer manual fuerza el botón', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.setDealer('C');
  tb.startHand();
  assert.strictEqual(tb.dealerId, 'C');
});
t('ciegas suben cada N manos', () => {
  const tb = mk(['A', 'B'], { blindsEvery: 2, smallBlind: 10, bigBlind: 20 });
  for (let i = 0; i < 3; i++) {
    tb.startHand();
    act(tb, tb.hand.toAct, 'fold');
  }
  assert(tb.settings.bigBlind > 20, 'BB=' + tb.settings.bigBlind);
});
t('ante se cobra a todos', () => {
  const tb = mk(['A', 'B', 'C'], { ante: 5 });
  tb.startHand();
  assert.strictEqual(E.potTotal(tb), 15 + 30);
});
t('jugador con menos que la ciega entra all-in', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.setStack('C', 7);
  tb.startHand();
  assert.strictEqual(stack(tb, 'C'), 0);
  assert.strictEqual(tb.hand.bets['C'], 7);
  assert.strictEqual(tb.hand.currentBet, 20);
  act(tb, 'A', 'call'); act(tb, 'B', 'call');
  // C all-in, A y B siguen
  assert.strictEqual(tb.hand.street, 1);
});
t('no se puede empezar con menos de 2 jugadores con fichas', () => {
  const tb = mk(['A', 'B']);
  tb.setStack('B', 0);
  assert(!tb.startHand().ok);
});
t('recompra sólo con 0 fichas y fuera de mano', () => {
  const tb = mk(['A', 'B']);
  assert(!tb.rebuy('A').ok);
  tb.setStack('A', 0);
  assert(tb.rebuy('A').ok);
  assert.strictEqual(stack(tb, 'A'), 1000);
  assert.strictEqual(tb.player('A').rebuys, 1);
});

console.log('Motor — salidas, deshacer, reloj');
t('jugador que sale en su turno se retira y pasa el turno', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  assert.strictEqual(tb.hand.toAct, 'A');
  assert(tb.removePlayer('A').ok);
  assert.strictEqual(tb.hand.toAct, 'B');
  act(tb, 'B', 'call');
  act(tb, 'C', 'check');
  assert.strictEqual(tb.hand.street, 1);
});
t('jugador que sale deja sus fichas apostadas en el bote', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  tb.removePlayer('C'); // era BB, ya puso 20
  act(tb, 'A', 'call'); act(tb, 'B', 'call');
  assert.strictEqual(tb.hand.street, 1);
  assert.strictEqual(E.potTotal(tb), 60);
  while (tb.phase === 'betting') { const id = tb.hand.toAct; act(tb, id, 'check'); }
  tb.resolve([['A']]);
  assert(!tb.player('C'), 'C ya no está sentado');
  assert.strictEqual(stack(tb, 'A'), 1040);
});
t('si sólo queda uno al salir los demás, gana la mano', () => {
  const tb = mk(['A', 'B']);
  tb.startHand();
  tb.removePlayer('A');
  assert.strictEqual(tb.phase, 'between');
  assert.strictEqual(stack(tb, 'B'), 1010); // BB puso 20 y se lleva 20 + 10 de la SB
  assert(!tb.player('A'), 'A salió de la mesa con sus 990');
  assert.strictEqual(totalChips(tb), 1010); // sólo queda B en la mesa
});
t('deshacer regresa exactamente al estado anterior', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand();
  const before = JSON.stringify(tb._plain(false));
  act(tb, 'A', 'raise', 100);
  assert(tb.undo().ok);
  const after = JSON.stringify(tb._plain(false));
  // el log sólo cambia por el mensaje de deshacer
  const strip = s => { const o = JSON.parse(s); delete o.log; delete o.logSeq; return JSON.stringify(o); };
  assert.strictEqual(strip(before), strip(after));
  act(tb, 'A', 'call');
});
t('deshacer una resolución devuelve el showdown', () => {
  const tb = mk(['A', 'B']);
  tb.startHand();
  act(tb, tb.hand.toAct, 'allin'); act(tb, tb.hand.toAct, 'call');
  tb.resolve([['A']]);
  assert.strictEqual(tb.phase, 'between');
  tb.undo();
  assert.strictEqual(tb.phase, 'showdown');
  assert.strictEqual(stack(tb, 'A'), 0);
  assert(tb.resolve([['B']]).ok);
  assert.strictEqual(stack(tb, 'B'), 2000);
});
t('reloj: al acabarse pasa si puede, si no se retira', () => {
  const tb = mk(['A', 'B', 'C'], { turnSeconds: 10 });
  tb.startHand();
  const t0 = tb.hand.turnStart;
  assert(!tb.tick(t0 + 5000));
  assert(tb.tick(t0 + 11000));
  assert(tb.hand.folded['A']);
});
t('snapshot es serializable y se puede restaurar', () => {
  const tb = mk(['A', 'B', 'C']);
  tb.startHand(); act(tb, 'A', 'raise', 80);
  const snap = JSON.parse(JSON.stringify(tb.snapshot()));
  const tb2 = new E.Table(snap);
  assert.strictEqual(tb2.hand.currentBet, 80);
  act(tb2, 'B', 'call');
});
t('invariante: fichas totales constantes en 300 manos aleatorias', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tb = mk(['A', 'B', 'C', 'D', 'E'], { startStack: 500, smallBlind: 5, bigBlind: 10 });
  const total = 2500;
  let hands = 0;
  for (let g = 0; g < 300; g++) {
    tb.players.forEach(p => { if (p.stack === 0) tb.rebuy(p.id); });
    const before = tb.players.reduce((a, p) => a + p.stack, 0);
    if (!tb.startHand().ok) { tb.reset(); continue; }
    let guard = 0;
    while (tb.phase === 'betting' && guard++ < 200) {
      const id = tb.hand.toAct, L = E.legal(tb, id);
      const r = rnd();
      let res;
      if (r < 0.15) res = tb.act(id, 'fold');
      else if (r < 0.25 && L.canRaise) res = tb.act(id, 'raise', L.minTo + Math.floor(rnd() * (L.maxTo - L.minTo + 1)));
      else if (r < 0.30 && (L.canRaise || L.callAllIn)) res = tb.act(id, 'allin');
      else res = tb.act(id, L.canCheck ? 'check' : 'call');
      assert(res.ok, res.error);
    }
    assert(guard < 200, 'bucle infinito');
    if (tb.phase === 'showdown') {
      const winners = tb.hand.pots.map(p => [p.eligible[Math.floor(rnd() * p.eligible.length)]]);
      assert(tb.resolve(winners).ok);
    }
    assert.strictEqual(tb.phase, 'between');
    const after = tb.players.reduce((a, p) => a + p.stack, 0);
    assert.strictEqual(after, before, 'mano ' + tb.handNo + ' cambió el total de fichas');
    hands++;
  }
  assert(hands > 100, 'pocas manos jugadas: ' + hands);
});
t('chipBreakdown descompone en denominaciones', () => {
  assert.deepStrictEqual(E.chipBreakdown(1735).map(x => x.d + 'x' + x.c), ['1000x1', '500x1', '100x2', '25x1', '5x2']);
});
t('runCommand respeta permisos', () => {
  const tb = mk(['A', 'B']);
  assert(!E.runCommand(tb, { c: 'start' }, { isHost: false, playerId: 'A' }).ok);
  assert(E.runCommand(tb, { c: 'start' }, { isHost: true, playerId: 'A' }).ok);
  assert(!E.runCommand(tb, { c: 'act', type: 'fold', as: 'B' }, { isHost: false, playerId: 'A' }).ok);
  assert(E.runCommand(tb, { c: 'act', type: 'fold', as: tb.hand.toAct }, { isHost: true }).ok);
});

console.log('\nMotor — cartas virtuales');
const H = str => E.bestHand(str.split(' '));
t('evaluador: las 10 categorías con su nombre', () => {
  const casos = [
    ['Ah Kh Qh Jh Th', 'Escalera real'], ['9c 8c 7c 6c 5c', 'Escalera de color'], ['As Ad Ah Ac 8c', 'Póker'],
    ['Kc Kh Kd 4s 4c', 'Full'], ['Qc 8c 6c 4c 3c', 'Color'], ['9c 8d 7h 6s 5c', 'Escalera'], ['Jc Jd Jh 5s 2c', 'Trío'],
    ['6c 6h As Ad Kc', 'Doble par'], ['Ah Ad 2c 5s 7d', 'Un par'], ['Kh 9s 6d 4c 3h', 'Carta alta']];
  casos.forEach(([c, n]) => assert.strictEqual(H(c).name, n, c));
});
t('evaluador: la rueda A-2-3-4-5 es escalera baja y pierde contra 2-6', () => {
  assert.strictEqual(H('Ac 2d 3h 4s 5c').name, 'Escalera');
  assert(H('2c 3d 4h 5s 6c').score > H('Ac 2d 3h 4s 5c').score);
  assert.strictEqual(H('Ac 2d 3h 4s 6c').name, 'Carta alta');
});
t('evaluador: ordena categorías, kickers y empates', () => {
  assert(H('As As Ah Ac 2c'.replace('As As', 'As Ad')).score > H('Kc Kh Kd Ks 2c').score);
  assert(H('Ac Kc 9d 5s 3h').score > H('Qc Jc 9d 5s 3h').score);
  assert(H('Ah Ad Kc 5s 3h').score > H('Ac Ad Qc 5s 3h').score, 'mejor kicker');
  assert.strictEqual(H('Ah Kd Qc Js 9h').score, H('As Kc Qh Jd 9c').score, 'empate exacto');
  assert(H('7c 7d 7h Kc Kd').score > H('6c 6d 6h Ac Ad').score);
});
t('evaluador: con 7 cartas toma la mejor combinación de 5', () => {
  assert.strictEqual(H('Ah Kh Qh Jh Th 2c 3d').name, 'Escalera real');
  assert.strictEqual(H('2c 2d 9h 9s Ac Kd 3h').text, 'Doble par de 9 y 2');
  assert.strictEqual(H('Ah Ad Ac Kc Kd Ks 2c').text, 'Full de A con K');
  assert.strictEqual(H('Ac 2c 3c 4c 9c Kd 5d').name, 'Color');
  assert.strictEqual(H('Ac 2d 3c 4c 5h Kd Kc').name, 'Escalera');
  assert.strictEqual(H('Ac 2d 3c 4c 5h Kd Kc').best.length, 5);
});
t('evaluador: con 2 a 4 cartas sólo reporta pares, tríos y póker', () => {
  assert.strictEqual(H('As Ad').text, 'Par de A');
  assert.strictEqual(H('Kc Qd').text, 'Carta alta K');
  assert.strictEqual(H('7c 7d 7h').name, 'Trío');
  assert.strictEqual(H('As Ad Kc Kd').name, 'Doble par');
});
t('mazo: 52 cartas distintas, sin jokers, y barajar no pierde ni repite', () => {
  const d = E.makeDeck();
  assert.strictEqual(d.length, 52); assert.strictEqual(new Set(d).size, 52);
  assert(d.every(c => /^[2-9TJQKA][cdhs]$/.test(c)));
  const m = E.shuffle(d.slice());
  assert.deepStrictEqual(m.slice().sort(), d.slice().sort());
  assert.notDeepStrictEqual(m, d);
});

const V = (names, extra) => mk(names, Object.assign({ cards: 'virtual' }, extra || {}));
// Fija las cartas de una mano virtual: holes = { id: 'As Kd' }, board = 'a b c d e'
function rig(tb, holes, board) {
  Object.keys(holes).forEach(id => { tb.secret.holes[id] = holes[id].split(' '); });
  tb.secret.board = board.split(' ');
}
t('cartas virtuales: ajuste válido y rechaza valores raros', () => {
  const tb = new E.Table();
  assert.strictEqual(tb.settings.cards, 'physical');
  assert(tb.setSettings({ cards: 'virtual' }).ok);
  assert(!tb.setSettings({ cards: 'holograma' }).ok);
});
t('cartas virtuales: cada jugador recibe 2 cartas y hay 5 en el tablero, todas distintas', () => {
  const tb = V(['A', 'B', 'C', 'D']);
  assert(tb.startHand().ok);
  const all = [];
  ['A', 'B', 'C', 'D'].forEach(id => { const c = tb.holeOf(id); assert.strictEqual(c.length, 2); all.push(...c); });
  all.push(...tb.secret.board);
  assert.strictEqual(all.length, 13); assert.strictEqual(new Set(all).size, 13);
  assert.deepStrictEqual(tb.hand.board, []);
});
t('cartas virtuales: el estado público no filtra cartas ocultas', () => {
  const tb = V(['A', 'B']);
  tb.startHand();
  const json = JSON.stringify(tb.snapshot());
  assert(!json.includes('secret') && !json.includes('holes'));
  tb.holeOf('A').concat(tb.secret.board).forEach(c => assert(!json.includes('"' + c + '"'), 'filtró ' + c));
  assert.strictEqual(tb.holeOf('Z'), null);
});
t('cartas virtuales: las cartas comunes se descubren por ronda (3, 4, 5)', () => {
  const tb = V(['A', 'B']);
  tb.startHand();
  rig(tb, { A: '2c 7d', B: '3c 8d' }, 'Ks Qs Js 9h 4d');
  const h = tb.hand;
  const callCheck = () => { const first = h.toAct, second = h.order.find(x => x !== first); act(tb, first, tb.legal ? 'check' : (E.legal(tb, first).canCheck ? 'check' : 'call')); act(tb, second, 'check'); };
  act(tb, h.toAct, 'call'); act(tb, h.toAct, 'check');
  assert.strictEqual(h.street, 1); assert.deepStrictEqual(h.board, ['Ks', 'Qs', 'Js']);
  act(tb, h.toAct, 'check'); act(tb, h.toAct, 'check');
  assert.strictEqual(h.street, 2); assert.deepStrictEqual(h.board, ['Ks', 'Qs', 'Js', '9h']);
  act(tb, h.toAct, 'check'); act(tb, h.toAct, 'check');
  assert.strictEqual(h.street, 3); assert.strictEqual(h.board.length, 5);
});
t('cartas virtuales: showdown automático da el bote al mejor y muestra las manos', () => {
  const tb = V(['A', 'B']);
  tb.startHand();
  rig(tb, { A: 'Ah Ad', B: 'Kc Kd' }, '2s 7h 9c Jd 3s');
  const h = tb.hand;
  act(tb, h.toAct, 'call'); act(tb, h.toAct, 'check');
  for (let i = 0; i < 6; i++) act(tb, h.toAct, 'check');
  assert.strictEqual(tb.phase, 'between');
  assert.strictEqual(stack(tb, 'A'), 1020); assert.strictEqual(stack(tb, 'B'), 980);
  assert.deepStrictEqual(h.shown.A, ['Ah', 'Ad']);
  assert.strictEqual(h.info.A.name, 'Un par'); assert.strictEqual(h.info.B.name, 'Un par');
  assert.deepStrictEqual(h.result.pots[0].winners, ['A']);
  assert.strictEqual(h.board.length, 5);
});
t('cartas virtuales: empate exacto reparte el bote', () => {
  const tb = V(['A', 'B']);
  tb.startHand();
  rig(tb, { A: '2c 3d', B: '2h 3s' }, 'Ah Ad Ks Kd 9c');
  act(tb, tb.hand.toAct, 'call'); act(tb, tb.hand.toAct, 'check');
  for (let i = 0; i < 6; i++) act(tb, tb.hand.toAct, 'check');
  assert.strictEqual(stack(tb, 'A'), 1000); assert.strictEqual(stack(tb, 'B'), 1000);
  assert.strictEqual(tb.hand.result.pots[0].winners.length, 2);
});
t('cartas virtuales: all-in preflop descubre las 5 y resuelve botes laterales', () => {
  const tb = V(['A', 'B', 'C'], { startStack: 1000 });
  tb.setStack('C', 300);
  assert(tb.startHand().ok);
  const h = tb.hand;
  rig(tb, { A: 'Ac Ad', B: 'Kc Kd', C: 'Qc Qd' }, '2s 7h 9c Jd 3s');
  // C (con menos fichas) mete todo, A y B igualan todo: bote principal 900 y lateral 1400
  let guard = 0;
  while (tb.phase === 'betting' && guard++ < 20) act(tb, h.toAct, 'allin');
  assert.strictEqual(tb.phase, 'between');
  assert.strictEqual(h.board.length, 5);
  assert.strictEqual(stack(tb, 'A'), 2300); assert.strictEqual(stack(tb, 'B'), 0); assert.strictEqual(stack(tb, 'C'), 0);
  assert.strictEqual(tb.players.reduce((a, p) => a + p.stack, 0), 2300);
});
t('cartas virtuales: un bote lateral lo gana el mejor entre los que entraron', () => {
  const tb = V(['A', 'B', 'C']);
  tb.setStack('C', 300);
  tb.startHand();
  const h = tb.hand;
  rig(tb, { A: '2c 3d', B: 'Kc Kd', C: 'Ac Ad' }, '5s 7h 9c Jd 8s');
  let g = 0;
  while (tb.phase === 'betting' && g++ < 20) act(tb, h.toAct, 'allin');
  // C gana el principal (900); B gana el lateral (1400); A no gana nada
  assert.strictEqual(stack(tb, 'C'), 900); assert.strictEqual(stack(tb, 'B'), 1400); assert.strictEqual(stack(tb, 'A'), 0);
});
t('cartas virtuales: si todos se retiran nadie muestra sus cartas', () => {
  const tb = V(['A', 'B', 'C']);
  tb.startHand();
  const h = tb.hand;
  act(tb, h.toAct, 'fold'); act(tb, h.toAct, 'fold');
  assert.strictEqual(tb.phase, 'between');
  assert.deepStrictEqual(h.shown, {});
  assert(h.result.uncontested);
});
t('cartas virtuales: deshacer conserva las mismas cartas', () => {
  const tb = V(['A', 'B']);
  tb.startHand();
  const a = tb.holeOf('A'), board = tb.secret.board.slice();
  act(tb, tb.hand.toAct, 'call');
  assert(tb.undo().ok);
  assert.deepStrictEqual(tb.holeOf('A'), a); assert.deepStrictEqual(tb.secret.board, board);
});
t('cartas virtuales: cada mano reparte cartas nuevas y con cartas físicas no hay mazo', () => {
  const tb = V(['A', 'B']);
  tb.startHand();
  const first = tb.holeOf('A').join();
  act(tb, tb.hand.toAct, 'fold');
  tb.startHand();
  assert.notStrictEqual(tb.secret, null);
  assert.strictEqual(tb.hand.board.length, 0);
  const fis = mk(['A', 'B']);
  fis.startHand();
  assert.strictEqual(fis.holeOf('A'), null); assert.strictEqual(fis.secret, null);
  assert.strictEqual(typeof first, 'string');
});
t('cartas virtuales: el ajuste no cambia a mitad de una mano', () => {
  const tb = V(['A', 'B']);
  tb.startHand();
  assert(!tb.setSettings({ cards: 'physical' }).ok);
});
t('cartas virtuales: se conservan al guardar y restaurar la mesa', () => {
  const tb = V(['A', 'B']);
  tb.startHand();
  const copy = new E.Table(tb._plain(true));
  assert.deepStrictEqual(copy.holeOf('A'), tb.holeOf('A'));
});

console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
process.exit(fail ? 1 : 0);
