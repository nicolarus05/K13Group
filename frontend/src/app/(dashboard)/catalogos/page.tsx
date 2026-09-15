'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Plus, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { catalogosService } from '@/modules/catalogos/services/catalogos.service';
import type { ProductoCatalogo, ReferenciaCatalogo, ServidorCatalogo, TarifaCatalogo } from '@/modules/catalogos/types/catalogos.types';

type Tab = 'productos' | 'tarifas' | 'servidores' | 'referencias';

export default function CatalogosPage() {
  const { success, error } = useToast();
  const [tab, setTab] = useState<Tab>('productos');
  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [tarifas, setTarifas] = useState<TarifaCatalogo[]>([]);
  const [servidores, setServidores] = useState<ServidorCatalogo[]>([]);
  const [referencias, setReferencias] = useState<ReferenciaCatalogo[]>([]);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [productoId, setProductoId] = useState('');
  const [precio, setPrecio] = useState('');
  const [duracionMeses, setDuracionMeses] = useState('12');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [productData, tariffData, serverData, referenceData] = await Promise.all([
        catalogosService.productos(), catalogosService.tarifas(), catalogosService.servidores(), catalogosService.referencias(),
      ]);
      setProductos(productData); setTarifas(tariffData); setServidores(serverData); setReferencias(referenceData);
      if (!productoId && productData[0]) setProductoId(productData[0].id);
    } catch { error('No se pudieron cargar los catálogos.'); }
    finally { setLoading(false); }
  }, [error, productoId]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!nombre.trim()) return;
    try {
      if (tab === 'productos') await catalogosService.crearProducto({ nombre, descripcion });
      if (tab === 'tarifas') {
        if (!productoId || !precio) { error('Selecciona un producto e indica el precio.'); return; }
        await catalogosService.crearTarifa({ productoId, nombre, duracionMeses: Number(duracionMeses), precio: Number(precio) });
      }
      if (tab === 'servidores') await catalogosService.crearServidor({ nombre });
      if (tab === 'referencias') await catalogosService.crearReferencia({ nombre, observaciones: descripcion });
      setNombre(''); setDescripcion(''); setPrecio('');
      await load(); success('Catálogo actualizado.');
    } catch { error('No se pudo crear el registro.', 'Comprueba que no exista otro con el mismo nombre.'); }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'productos', label: 'Productos' }, { id: 'tarifas', label: 'Tarifas' }, { id: 'servidores', label: 'Servidores' }, { id: 'referencias', label: 'Referencias' },
  ];
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><h1 className="text-xl font-semibold text-text-main">Catálogos</h1><p className="mt-1 text-sm text-text-secondary">Gestiona productos, tarifas, servidores y clientes referentes sin modificar el histórico original.</p></div>
    <div className="flex flex-wrap gap-2">{tabs.map((item) => <Button key={item.id} variant={tab === item.id ? 'primary' : 'secondary'} onClick={() => setTab(item.id)}>{item.label}</Button>)}<Button variant="ghost" onClick={() => void load()} loading={loading}><RefreshCw className="h-4 w-4" />Actualizar</Button></div>
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <Card><CardHeader><CardTitle><Plus className="mr-2 inline h-4 w-4" />Nuevo registro</CardTitle></CardHeader><CardContent className="space-y-3">
        {tab === 'tarifas' && <><Select label="Producto" value={productoId} onChange={setProductoId} options={productos.map((item) => ({ value: item.id, label: item.nombre }))} /><Input label="Nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} placeholder="Ej. MAXPLAYER - 75€/año" /><Input label="Precio anual" type="number" min="0" step="0.01" value={precio} onChange={(event) => setPrecio(event.target.value)} /><Input label="Duración (meses)" type="number" min="1" value={duracionMeses} onChange={(event) => setDuracionMeses(event.target.value)} /></>}
        {tab !== 'tarifas' && <Input label="Nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} placeholder={tab === 'productos' ? 'Nombre de la aplicación' : tab === 'servidores' ? 'Nombre del servidor' : 'Nombre del cliente referente'} />}
        {(tab === 'productos' || tab === 'referencias') && <Input label={tab === 'productos' ? 'Descripción' : 'Observaciones'} value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />}
        <Button className="w-full" onClick={() => void submit()}><Plus className="h-4 w-4" />Crear</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{tabs.find((item) => item.id === tab)?.label}</CardTitle><Badge variant="default">{tab === 'productos' ? productos.length : tab === 'tarifas' ? tarifas.length : tab === 'servidores' ? servidores.length : referencias.length}</Badge></CardHeader><CardContent>
        {tab === 'productos' && <div className="grid gap-2 sm:grid-cols-2">{productos.map((item) => <CatalogItem key={item.id} title={item.nombre} detail={item.descripcion ?? 'Sin descripción'} />)}</div>}
        {tab === 'tarifas' && <div className="space-y-2">{tarifas.map((item) => <CatalogItem key={item.id} title={item.nombre} detail={`${item.producto.nombre} · ${item.duracionMeses} meses · ${item.precio} €`} />)}</div>}
        {tab === 'servidores' && <div className="grid gap-2 sm:grid-cols-3">{servidores.map((item) => <CatalogItem key={item.id} title={item.nombre} detail={item.activo ? 'Activo' : 'Inactivo'} />)}</div>}
        {tab === 'referencias' && <div className="grid max-h-[560px] gap-2 overflow-auto sm:grid-cols-2">{referencias.map((item) => <CatalogItem key={item.id} title={item.nombre} detail={item.observaciones ?? 'Cliente referente'} />)}</div>}
      </CardContent></Card>
    </div>
  </div>;
}

function CatalogItem({ title, detail }: { title: string; detail: string }) { return <div className="flex items-start gap-2 rounded-input bg-background p-3"><BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-sm font-medium text-text-main">{title}</p><p className="text-xs text-text-secondary">{detail}</p></div></div>; }
