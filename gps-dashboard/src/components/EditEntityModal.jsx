import React, { useState } from 'react';
import { X, Save, Edit3, Loader } from 'lucide-react';

export const EditEntityModal = ({ entity, category, onClose, onSave }) => {
  const [name, setName] = useState(entity?.name || '');
  const [plate, setPlate] = useState(entity?.plate || '');
  const [model, setModel] = useState(entity?.model || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    
    const updates = {};
    if (category === 'vehicles') {
      updates.name = name;
      updates.plate = plate;
    } else {
      updates.label = name;
      updates.model = model;
    }

    try {
      await onSave(entity.id, category, updates);
      onClose();
    } catch (err) {
      setError(err.message || 'Error al guardar cambios');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Editar ${category === 'vehicles' ? 'vehículo' : 'dispositivo'}`}>
      <div className="w-full max-w-sm rounded-xl border border-[#2b4c59] bg-[#0c1a20] p-6 shadow-2xl relative">
        <button onClick={onClose} className="absolute right-4 top-4 text-[#8b9ba1] hover:text-white transition-colors" disabled={isSaving}>
          <X size={20} />
        </button>
        
        <div className="flex items-center gap-3 mb-6 border-b border-[#2b4c59] pb-4">
          <div className="rounded-full bg-[#102b38] p-2 text-[#b8f36b]">
            <Edit3 size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Editar {category === 'vehicles' ? 'Vehículo' : 'Dispositivo'}</h2>
            <p className="text-xs text-[#8b9ba1] truncate w-48">{entity?.id}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-900/20 border border-red-500/50 rounded-lg p-3 text-red-200 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#73838a] mb-1">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#1f4d59] bg-[#0d1d26] px-3 py-2 text-sm text-[#edf5ef] focus:border-[#67e8f9] focus:outline-none focus:ring-1 focus:ring-[#67e8f9]"
              placeholder="Ej. Moto de Reparto"
              required
            />
          </div>

          {category === 'vehicles' ? (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#73838a] mb-1">Placa</label>
              <input
                type="text"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                className="w-full rounded-lg border border-[#1f4d59] bg-[#0d1d26] px-3 py-2 text-sm text-[#edf5ef] focus:border-[#67e8f9] focus:outline-none focus:ring-1 focus:ring-[#67e8f9]"
                placeholder="Ej. ABC-1234"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#73838a] mb-1">Modelo / Referencia</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-[#1f4d59] bg-[#0d1d26] px-3 py-2 text-sm text-[#edf5ef] focus:border-[#67e8f9] focus:outline-none focus:ring-1 focus:ring-[#67e8f9]"
                placeholder="Ej. Samsung Galaxy S23"
              />
            </div>
          )}

          <div className="mt-6 flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 rounded-lg border border-[#2b4c59] bg-transparent py-2.5 text-sm font-bold text-[#8b9ba1] hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#b8f36b] py-2.5 text-sm font-bold text-[#0c1a20] hover:bg-[#c8ef9b]"
            >
              {isSaving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
