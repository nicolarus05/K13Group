// Navegador real con API ficticia; no escribe en la base de trabajo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright-core');
const origin = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';
let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
});
after(async () => browser?.close());
const types = [
  ['CLIENTE_CREADO', 'Cliente Creado'],
  ['SUSCRIPCION_RENOVADA', 'Suscripción Renovada'],
  ['DEMO_CREADA', 'Demo Creada'],
  ['SUSCRIPCION_POR_VENCER', 'Suscripción por vencer'],
  ['SUSCRIPCION_VENCIDA', 'Suscripción Vencida'],
];
const base =
  'Hola {{nombre_cliente}}! 👋\n👤 {{usuario}}\n🔑 {{contrasena}}\n📺 {{conexiones}}\n📅 {{vencimiento}}\n🖥 {{aplicacion}}\n💶 {{importe_pagado}}';
const demo = base.replace('\n💶 {{importe_pagado}}', '');
async function fixture(t, options = {}) {
  const context = await browser.newContext({
    viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  });
  await context.addCookies([{ name: 'access_token', value: 'message-ui-test', url: origin }]);
  await context.addInitScript(
    ({ fail }) =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value) => {
            if (fail) throw new Error('Denied');
            window.copiedMessage = value;
          },
        },
      }),
    { fail: !!options.clipboardFails },
  );
  const page = await context.newPage(),
    errors = [],
    requests = [],
    writes = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  const client = {
    id: randomUUID(),
    nombre: 'Cliente de prueba',
    telefono: null,
    email: null,
    estado: { valor: 'ACTIVO' },
    createdAt: '2026-10-30T00:00:00Z',
    suscripciones: [],
  };
  const periods = [
    {
      id: randomUUID(),
      inicio: '2026-10-01',
      vencimiento: '2027-10-01',
      tipo: 'ALTA',
      aplicacion: 'MAXPLAYER',
      pagado: '140.00',
      pendiente: '0.00',
      estadoPago: 'Pagado',
    },
    {
      id: randomUUID(),
      inicio: '2025-10-01',
      vencimiento: '2026-10-01',
      tipo: 'ALTA',
      aplicacion: 'Aplicación antigua',
      pagado: '75.00',
      pendiente: '0.00',
      estadoPago: 'Pagado',
    },
  ];
  const sub = {
    id: randomUUID(),
    version: 1,
    aplicacion: 'MAXPLAYER',
    servidor: 'DEAD',
    inicio: '2026-10-01',
    vencimiento: '2027-10-01',
    estado: 'ACTIVA',
    periodos: periods,
  };
  const second = {
    ...sub,
    id: randomUUID(),
    aplicacion: 'KDSPLAYER',
    periodos: [
      {
        ...periods[0],
        id: randomUUID(),
        aplicacion: 'KDSPLAYER',
        pagado: '0.00',
        pendiente: '75.00',
        estadoPago: 'Pendiente',
      },
    ],
  };
  const messageContext = {
    cliente: { id: client.id, nombre: client.nombre },
    suscripciones: options.noSubscriptions ? [] : options.multiple ? [sub, second] : [sub],
  };
  const templates = types.map(([tipo, nombre]) => ({
    tipo,
    nombre,
    version: 0,
    texto:
      tipo === 'DEMO_CREADA'
        ? demo
        : tipo === 'CLIENTE_CREADO'
          ? base
          : 'Hola {{nombre_cliente}}\n{{aplicacion}} · {{vencimiento}}\nPagado: {{importe_pagado}}\nPendiente: {{importe_pendiente}}\n{{estado_pago}}',
    textoInicial: tipo === 'DEMO_CREADA' ? demo : base,
  }));
  let conflicts = 0,
    failures = 0;
  const paged = (data) => ({
    success: true,
    data,
    pagination: { page: 1, limit: 25, total: data.length, totalPages: 1 },
  });
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace('/api/v1/', '');
    requests.push({ url: req.url(), body: req.postData() });
    let body = paged([]),
      status = 200;
    if (req.method() !== 'GET') {
      writes.push({ path, dto: req.postDataJSON() });
      assert.ok(path.startsWith('mensajes/plantillas/'), 'Unexpected mutation ' + path);
      const current = templates.find((p) => p.tipo === path.split('/').at(-1)),
        dto = req.postDataJSON();
      if (options.conflict && conflicts++ === 0) {
        current.version++;
        current.texto = 'Texto guardado por otra sesión';
        status = 409;
        body = { message: 'La plantilla ha cambiado. Tu borrador se conserva.' };
      } else {
        assert.deepEqual(Object.keys(dto).sort(), ['texto', 'version']);
        assert.equal(dto.version, current.version);
        Object.assign(current, { texto: dto.texto, version: current.version + 1 });
        body = current;
      }
    } else if (path === 'auth/me')
      body = { data: { id: 'test', nombre: 'Prueba', username: 'admin' } };
    else if (path === 'configuracion') body = { data: { valores: {}, version: 0 } };
    else if (path === 'recordatorios/resumen') body = { data: { atencion: 0 } };
    else if (path === 'clientes') body = paged([client]);
    else if (path === 'clientes/' + client.id) body = { data: client };
    else if (path === 'mensajes/plantillas')
      body = {
        plantillas: templates,
        variables: [
          'nombre_cliente',
          'usuario',
          'contrasena',
          'conexiones',
          'vencimiento',
          'aplicacion',
          'importe_pagado',
          'importe_pendiente',
          'estado_pago',
        ],
      };
    else if (path === 'mensajes/clientes/' + client.id) {
      if (options.failOnce && failures++ === 0) {
        status = 503;
        body = { message: 'Fallo de prueba' };
      } else body = messageContext;
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + (options.settings ? '/configuracion?tab=plantillas' : '/clientes'));
  async function open(label = 'Cliente Creado') {
    await page.getByRole('button', { name: 'Mensajes para ' + client.nombre, exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await page.getByRole('dialog').waitFor();
    if (!options.failOnce)
      await page
        .getByText('Los datos de acceso se utilizan solo en esta ventana', { exact: false })
        .waitFor();
  }
  async function credentials() {
    await page.getByLabel('Usuario del servicio', { exact: true }).fill('usuario-$&-PRIVADO');
    await page
      .getByLabel('Contraseña del servicio', { exact: true })
      .fill('<script>PRIVADO-$&</script>');
    await page.getByLabel('Conexiones', { exact: true }).fill('2');
  }
  return {
    page,
    context,
    client,
    sub,
    second,
    periods,
    open,
    credentials,
    writes,
    requests,
    templates,
  };
}
test('previsualiza 140 EUR, copia texto literal y descarta credenciales al cerrar sin enviarlas', async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.credentials();
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  const output = f.page.getByLabel('Mensaje listo para copiar', { exact: true });
  const text = await output.inputValue();
  assert.match(text, /140,00/);
  assert.match(text, /01\/10\/2027/);
  assert.ok(text.includes('<script>PRIVADO-$&</script>'));
  await output.fill(text + '\nMensaje personalizado');
  await f.page.getByRole('button', { name: 'Copiar mensaje', exact: true }).click();
  await f.page.getByText('Mensaje copiado.', { exact: true }).waitFor();
  assert.equal(await f.page.evaluate(() => window.copiedMessage), text + '\nMensaje personalizado');
  assert.deepEqual(f.writes, []);
  assert.ok(!JSON.stringify(f.requests).includes('PRIVADO'));
  assert.ok(
    !(
      await f.page.evaluate(() =>
        JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
      )
    ).includes('PRIVADO'),
  );
  await f.page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await f.open();
  assert.equal(await f.page.getByLabel('Usuario del servicio', { exact: true }).inputValue(), '');
  assert.equal(
    await f.page.getByLabel('Contraseña del servicio', { exact: true }).inputValue(),
    '',
  );
});
test('exige seleccionar entre varios servicios y mantiene separados periodos, pagos y deudas', async (t) => {
  const f = await fixture(t, { multiple: true });
  await f.open('Suscripción Renovada');
  const select = f.page.getByLabel('Suscripción', { exact: true });
  assert.equal(await select.inputValue(), '');
  await select.selectOption(f.sub.id);
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  assert.match(
    await f.page.getByLabel('Mensaje listo para copiar', { exact: true }).inputValue(),
    /140,00/,
  );
  await f.page.getByLabel('Periodo e importes', { exact: true }).selectOption(f.periods[1].id);
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  const historic = await f.page
    .getByLabel('Mensaje listo para copiar', { exact: true })
    .inputValue();
  assert.match(historic, /Aplicación antigua/);
  assert.match(historic, /75,00/);
  assert.match(historic, /01\/10\/2026/);
  await select.selectOption(f.second.id);
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  const debt = await f.page.getByLabel('Mensaje listo para copiar', { exact: true }).inputValue();
  assert.match(debt, /Pagado: 0,00/);
  assert.match(debt, /Pendiente: 75,00/);
  assert.match(debt, /KDSPLAYER/);
  assert.deepEqual(f.writes, []);
});
test('no copia marcas pendientes y permite retirar variables del texto particular', async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  assert.equal(
    await f.page.getByRole('button', { name: 'Copiar mensaje', exact: true }).isDisabled(),
    true,
  );
  await f.page.getByText('Adaptar el texto solo para este mensaje', { exact: true }).click();
  await f.page
    .getByLabel('Texto para este mensaje', { exact: true })
    .fill('Hola {{nombre_cliente}} 👋');
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  await f.page.getByRole('button', { name: 'Copiar mensaje', exact: true }).click();
  await f.page.getByText('Mensaje copiado.', { exact: true }).waitFor();
  assert.deepEqual(f.writes, []);
});
test('demo sin suscripción: aplicación y fecha/hora manuales, menú por teclado y móvil', async (t) => {
  const f = await fixture(t, { noSubscriptions: true, mobile: true });
  await f.page.getByRole('button', { name: 'Mensajes para ' + f.client.nombre }).focus();
  await f.page.keyboard.press('ArrowDown');
  assert.equal(await f.page.getByRole('menuitem').count(), 5);
  await f.page.keyboard.press('ArrowDown');
  await f.page.keyboard.press('ArrowDown');
  await f.page.keyboard.press('Enter');
  await f.page.getByRole('dialog', { name: 'Demo Creada' }).waitFor();
  await f.credentials();
  await f.page.getByLabel('Aplicación de la demo', { exact: true }).fill('Demo TV');
  await f.page
    .getByLabel('Vencimiento de la demo (hora de Madrid)', { exact: true })
    .fill('2026-11-01T23:30');
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  const text = await f.page.getByLabel('Mensaje listo para copiar', { exact: true }).inputValue();
  assert.match(text, /01\/11\/2026 23:30 \(Madrid\)/);
  assert.match(text, /Demo TV/);
  assert.ok(!text.includes('⟦Completar:'));
  const dimensions = await f.page.getByRole('dialog').evaluate((e) => ({
    width: e.clientWidth,
    scroll: e.scrollWidth,
    overflow: [...e.querySelectorAll('*')]
      .filter((n) => n.getBoundingClientRect().right > e.getBoundingClientRect().right)
      .map((n) => ({
        tag: n.tagName,
        type: n.type,
        width: n.getBoundingClientRect().width,
        classes: n.className,
      })),
  }));
  assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions));
  assert.deepEqual(f.writes, []);
});
test('si falla el portapapeles selecciona el texto para copiarlo manualmente', async (t) => {
  const f = await fixture(t, { clipboardFails: true });
  await f.open();
  await f.credentials();
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  await f.page.getByRole('button', { name: 'Copiar mensaje', exact: true }).click();
  await f.page.getByText(/No se pudo copiar automáticamente/).waitFor();
  assert.equal(
    await f.page
      .getByLabel('Mensaje listo para copiar', { exact: true })
      .evaluate((e) => e.selectionStart === 0 && e.selectionEnd === e.value.length),
    true,
  );
});
test('edita, valida y guarda la plantilla; recuperar el texto inicial requiere guardarlo', async (t) => {
  const f = await fixture(t, { settings: true });
  await f.page.getByText('Cliente Creado', { exact: true }).click();
  const field = f.page.getByLabel('Texto de Cliente Creado', { exact: true }),
    panel = f.page.locator('details').filter({ has: field });
  for (const variable of ['inexistente', '__proto__', 'constructor']) {
    await field.fill('Hola {{' + variable + '}}');
    assert.equal(
      await panel.getByRole('button', { name: 'Guardar plantilla', exact: true }).isDisabled(),
      true,
    );
    await panel.getByText('Variable no admitida: ' + variable, { exact: true }).waitFor();
  }
  await field.fill('Personalizado {{nombre_cliente}}');
  await panel.getByRole('button', { name: 'Guardar plantilla', exact: true }).click();
  await panel.getByText('Plantilla guardada.', { exact: true }).waitFor();
  assert.equal(f.writes.length, 1);
  assert.equal(f.templates[0].texto, 'Personalizado {{nombre_cliente}}');
  await panel.getByRole('button', { name: 'Usar texto inicial', exact: true }).click();
  assert.equal(f.writes.length, 1);
  await panel.getByRole('button', { name: 'Guardar plantilla', exact: true }).click();
  await panel.getByText('Plantilla guardada.', { exact: true }).waitFor();
  assert.equal(f.templates[0].texto, base);
});
test('conserva borrador ante conflicto y permite comparar la versión guardada antes de reintentar', async (t) => {
  const f = await fixture(t, { settings: true, conflict: true });
  await f.page.getByText('Cliente Creado', { exact: true }).click();
  const field = f.page.getByLabel('Texto de Cliente Creado', { exact: true }),
    panel = f.page.locator('details').filter({ has: field });
  await field.fill('Mi borrador {{nombre_cliente}}');
  await panel.getByRole('button', { name: 'Guardar plantilla', exact: true }).click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await field.inputValue(), 'Mi borrador {{nombre_cliente}}');
  await panel.getByRole('button', { name: 'Consultar versión guardada', exact: true }).click();
  await panel.getByText('Texto guardado por otra sesión', { exact: true }).waitFor();
  assert.equal(await field.inputValue(), 'Mi borrador {{nombre_cliente}}');
  await panel
    .getByRole('button', { name: 'Conservar mi borrador sobre esta versión', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Guardar plantilla', exact: true }).click();
  await panel.getByText('Plantilla guardada.', { exact: true }).waitFor();
  assert.equal(f.templates[0].version, 2);
});
test('permite reintentar una carga fallida y cambiar de servicio limpia los datos de acceso', async (t) => {
  const f = await fixture(t, { multiple: true, failOnce: true });
  await f.open();
  await f.page.getByRole('button', { name: 'Reintentar mensaje', exact: true }).click();
  await f.page.getByLabel('Suscripción', { exact: true }).selectOption(f.sub.id);
  await f.credentials();
  await f.page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
  await f.page.getByLabel('Suscripción', { exact: true }).selectOption(f.second.id);
  assert.equal(
    await f.page.getByLabel('Contraseña del servicio', { exact: true }).inputValue(),
    '',
  );
  assert.equal(await f.page.getByLabel('Usuario del servicio', { exact: true }).inputValue(), '');
  assert.equal(
    await f.page.getByLabel('Contraseña del servicio', { exact: true }).getAttribute('type'),
    'password',
  );
  assert.deepEqual(f.writes, []);
});

test('Tab sale del menú hacia las acciones del mismo cliente', async (t) => {
  const f = await fixture(t);
  await f.page.getByRole('button', { name: 'Mensajes para ' + f.client.nombre }).click();
  await f.page.getByRole('menu').waitFor();
  await f.page.keyboard.press('Tab');
  await f.page.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal(
    await f.page
      .getByRole('button', { name: 'Editar', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
});

test('el menú se cierra al desplazar la lista y no queda asociado a otra fila', async (t) => {
  const f = await fixture(t);
  await f.page.getByRole('button', { name: 'Mensajes para ' + f.client.nombre }).click();
  await f.page.getByRole('menu').waitFor();
  await f.page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
  // Un evento atrasado sin movimiento del botón no debe cerrar el menú recién abierto.
  await f.page.locator('.k13-main').evaluate((e) => e.dispatchEvent(new Event('scroll')));
  assert.equal(await f.page.getByRole('menu').isVisible(), true);
  await f.page.locator('.k13-main').evaluate((e) => {
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    e.append(spacer);
  });
  const scroll = await f.page.locator('.k13-main').evaluate((e) => {
    e.scrollTop += 100;
    return { top: e.scrollTop, height: e.clientHeight, scroll: e.scrollHeight };
  });
  assert.ok(scroll.top > 0, JSON.stringify(scroll));
  await f.page.getByRole('menu').waitFor({ state: 'hidden', timeout: 3000 });
});

test('los campos con solo espacios siguen pendientes y los valores válidos conservan sus espacios', async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.credentials();
  await f.page.getByLabel('Usuario del servicio', { exact: true }).fill('   ');
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  const output = f.page.getByLabel('Mensaje listo para copiar', { exact: true });
  assert.match(await output.inputValue(), /⟦Completar: usuario⟧/);
  assert.equal(
    await f.page.getByRole('button', { name: 'Copiar mensaje', exact: true }).isDisabled(),
    true,
  );
  await f.page.getByLabel('Usuario del servicio', { exact: true }).fill(' usuario válido ');
  await f.page.getByLabel('Contraseña del servicio', { exact: true }).fill(' clave con espacios ');
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  assert.ok((await output.inputValue()).includes(' clave con espacios '));
  assert.equal(
    await f.page.getByRole('button', { name: 'Copiar mensaje', exact: true }).isDisabled(),
    false,
  );
});

test('no atribuye el cobro de un periodo antiguo a las fechas actuales sin operación', async (t) => {
  const f = await fixture(t);
  f.sub.inicio = '2027-10-01';
  f.sub.vencimiento = '2028-10-01';
  await f.open('Suscripción Renovada');
  assert.equal(await f.page.getByLabel('Periodo e importes', { exact: true }).inputValue(), '');
  await f.page.getByRole('button', { name: 'Previsualizar mensaje', exact: true }).click();
  const text = await f.page.getByLabel('Mensaje listo para copiar', { exact: true }).inputValue();
  assert.match(text, /01\/10\/2028/);
  assert.match(text, /⟦Completar: importe_pagado⟧/);
  assert.ok(!text.includes('140,00'));
  assert.equal(
    await f.page.getByRole('button', { name: 'Copiar mensaje', exact: true }).isDisabled(),
    true,
  );
});

test('el menú cabe en una pantalla baja y permite recorrerlo y cerrarlo con teclado', async (t) => {
  const f = await fixture(t);
  await f.page.setViewportSize({ width: 900, height: 220 });
  const trigger = f.page.getByRole('button', { name: 'Mensajes para ' + f.client.nombre });
  await trigger.click();
  await f.page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
  await f.page.keyboard.press('End');
  const bounds = await f.page.getByRole('menu').boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 220, JSON.stringify(bounds));
  assert.equal(
    await f.page
      .getByRole('menuitem', { name: 'Suscripción Vencida', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await f.page.keyboard.press('Escape');
  await f.page.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate((e) => e === document.activeElement), true);
});
