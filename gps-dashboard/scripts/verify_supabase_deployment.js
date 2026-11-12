/**
 * Script de auditoría y verificación pre-vuelo de Supabase para Staging y Producción
 * 
 * Uso:
 *   SUPABASE_URL="https://tu-proyecto.supabase.co" SUPABASE_SERVICE_ROLE_KEY="tu-key" node scripts/verify_supabase_deployment.js
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-key';

console.log('=====================================================');
console.log('🔍 Auditoría de Despliegue de Supabase - Pre-Flight');
console.log('=====================================================');

if (!supabaseUrl || supabaseUrl.includes('your-project')) {
  console.error('❌ ERROR: SUPABASE_URL no configurado. Se requieren secretos reales para verificar en CI.');
  process.exit(1);
}

if (!serviceRoleKey || serviceRoleKey === 'your-key') {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY no configurado. Se requiere un secreto real para auditar objetos protegidos por RLS.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function verifyDeployment() {
  const auditResults = [];
  let hasFailures = false;

  // 1. Verificar tablas requeridas
  const requiredTables = [
    'organizations',
    'profiles',
    'devices',
    'vehicles',
    'alerts',
    'geofences',
    'gps_locations',
    'device_registry',
    'provision_rate_limits',
    'orphan_auth_users',
  ];
  for (const table of requiredTables) {
    try {
      const { error } = await supabase.from(table).select('*').limit(1);
      if (error && error.code !== 'PGRST116') {
        auditResults.push({ check: `Tabla ${table}`, status: 'FAIL', detail: error.message });
        hasFailures = true;
      } else {
        auditResults.push({ check: `Tabla ${table}`, status: 'PASS', detail: 'Existe y accesible' });
      }
    } catch (err) {
      auditResults.push({ check: `Tabla ${table}`, status: 'FAIL', detail: err.message });
      hasFailures = true;
    }
  }

  // 2. Verificar vista latest_gps_locations
  try {
    const { error } = await supabase.from('latest_gps_locations').select('device_id').limit(1);
    if (error) {
      auditResults.push({ check: 'Vista latest_gps_locations', status: 'WARN', detail: 'No encontrada. Se usará el fallback de gps_locations' });
    } else {
      auditResults.push({ check: 'Vista latest_gps_locations', status: 'PASS', detail: 'Vista optimizada activa' });
    }
  } catch (err) {
    auditResults.push({ check: 'Vista latest_gps_locations', status: 'WARN', detail: err.message });
  }

  // 3. Verificar RPCs requeridas
  const requiredRpcs = [
    'check_rate_limit',
    'record_rate_limit_failure',
    'clear_rate_limit',
    'update_device_telemetry',
    'delete_vehicle_cascade',
  ];
  for (const rpcName of requiredRpcs) {
    try {
      const { error } = await supabase.rpc(rpcName, {});
      if (!error) {
        auditResults.push({ check: `RPC ${rpcName}`, status: 'PASS', detail: 'Función SQL registrada' });
      } else {
        const errMsg = String(error.message || '').toLowerCase();
        const errCode = String(error.code || '');

        if (errCode === 'PGRST202' || errMsg.includes('not found') || errMsg.includes('does not exist') || errMsg.includes('could not find the function')) {
          auditResults.push({ check: `RPC ${rpcName}`, status: 'FAIL', detail: 'Función SQL no existe' });
          hasFailures = true;
        } else if (errCode === '42501' || errMsg.includes('permission denied')) {
          auditResults.push({ check: `RPC ${rpcName}`, status: 'WARN', detail: `Permisos insuficientes (${error.message})` });
        } else if (errMsg.includes('fetch') || errMsg.includes('enotfound') || errMsg.includes('network') || errCode === 'PGRST000') {
          auditResults.push({ check: `RPC ${rpcName}`, status: 'FAIL', detail: `Error de conexión (${error.message})` });
          hasFailures = true;
        } else if (
          errCode === 'PGRST202' ||
          errCode === '42883' ||
          errCode === '42P01' ||
          errCode === '42804' ||
          errMsg.includes('function') ||
          errMsg.includes('routine')
        ) {
          auditResults.push({ check: `RPC ${rpcName}`, status: 'FAIL', detail: `Función SQL no existe o su firma no resuelve (${error.code}: ${error.message})` });
          hasFailures = true;
        } else {
          auditResults.push({ check: `RPC ${rpcName}`, status: 'PASS', detail: `Función SQL existe (error de parámetros esperado: ${error.message})` });
        }
      }
    } catch (err) {
      const errMsg = String(err.message || '').toLowerCase();
      if (errMsg.includes('not found') || errMsg.includes('does not exist')) {
        auditResults.push({ check: `RPC ${rpcName}`, status: 'FAIL', detail: 'Función SQL no existe' });
        hasFailures = true;
      } else if (errMsg.includes('fetch') || errMsg.includes('network')) {
        auditResults.push({ check: `RPC ${rpcName}`, status: 'FAIL', detail: `Error de red (${err.message})` });
        hasFailures = true;
      } else {
        auditResults.push({ check: `RPC ${rpcName}`, status: 'PASS', detail: `Registrada (${err.message || 'OK'})` });
      }
    }
  }

  console.table(auditResults);
  if (hasFailures) {
    console.error('\n❌ Auditoría de Supabase falló. Hay requerimientos faltantes.');
    process.exit(1);
  } else {
    console.log('\n✅ Auditoría de Supabase finalizada y aprobada.');
  }
}

verifyDeployment().catch((err) => {
  console.error('❌ Error en auditoría:', err);
  process.exit(1);
});
