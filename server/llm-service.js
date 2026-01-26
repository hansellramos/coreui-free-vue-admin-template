const AI_MODELS = {
  anthropic_claude: {
    code: 'anthropic_claude',
    name: 'Anthropic Claude',
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com',
    env_key: 'ANTHROPIC_API_KEY'
  },
  xai_grok: {
    code: 'xai_grok',
    name: 'xAI Grok',
    model: 'grok-4',
    provider: 'openai_compatible',
    base_url: 'https://api.x.ai/v1',
    env_key: 'GROK_API_KEY'
  },
  openai_gpt4o: {
    code: 'openai_gpt4o',
    name: 'OpenAI GPT-4o',
    model: 'gpt-4o',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    env_key: 'OPENAI_API_KEY'
  },
  openai_gpt4o_mini: {
    code: 'openai_gpt4o_mini',
    name: 'OpenAI GPT-4o Mini',
    model: 'gpt-4o-mini',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    env_key: 'OPENAI_API_KEY'
  }
};

function getModelConfig(providerCode) {
  return AI_MODELS[providerCode] || null;
}

function getApiKeyForProvider(providerCode) {
  const config = getModelConfig(providerCode);
  if (!config) return null;
  return process.env[config.env_key] || null;
}

async function callLLMByCode(providerCode, messages, options = {}) {
  const config = getModelConfig(providerCode);
  if (!config) {
    throw new Error(`Modelo no encontrado: ${providerCode}`);
  }
  
  const apiKey = getApiKeyForProvider(providerCode);
  if (!apiKey) {
    throw new Error(`API key no configurada para ${config.name} (${config.env_key})`);
  }
  
  if (config.provider === 'anthropic') {
    return callAnthropicAPI(apiKey, config.model, messages, options);
  } else {
    return callOpenAICompatibleAPI(apiKey, config.base_url, config.model, messages, options);
  }
}

async function callLLM(provider, messages, options = {}) {
  const { code, api_key, base_url, model, config } = provider;
  
  if (!api_key) {
    throw new Error(`El proveedor ${provider.name} no tiene API key configurada`);
  }
  
  if (code === 'anthropic') {
    return callAnthropicAPI(api_key, model, messages, options);
  } else {
    return callOpenAICompatibleAPI(api_key, base_url, model, messages, options);
  }
}

async function callOpenAICompatibleAPI(apiKey, baseUrl, model, messages, options = {}) {
  const startTime = Date.now();
  const { maxTokens = 1024, temperature = 0.7, tools } = options;
  
  console.log(`[llm-service] OpenAI-compatible API call starting: model=${model}, messages=${messages.length}, maxTokens=${maxTokens}`);
  
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature
  };
  
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  const responseTime = Date.now() - startTime;
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`[llm-service] OpenAI-compatible API error after ${responseTime}ms:`, error);
    throw new Error(`Error del proveedor LLM: ${error}`);
  }
  
  const data = await response.json();
  const choice = data.choices[0];
  
  console.log(`[llm-service] OpenAI-compatible API completed: ${responseTime}ms, usage: input=${data.usage?.prompt_tokens || 'N/A'}, output=${data.usage?.completion_tokens || 'N/A'}`);
  
  return {
    content: choice?.message?.content || '',
    tool_calls: choice?.message?.tool_calls || null,
    usage: data.usage || {},
    model: data.model || model
  };
}

async function callAnthropicAPI(apiKey, model, messages, options = {}) {
  const startTime = Date.now();
  const { maxTokens = 1024, temperature = 0.7, tools } = options;
  
  console.log(`[llm-service] Anthropic API call starting: model=${model}, messages=${messages.length}, maxTokens=${maxTokens}`);
  
  const systemMessage = messages.find(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');
  
  // Check if any message has block content (tool_use/tool_result)
  const hasBlockContent = otherMessages.some(m => Array.isArray(m.content));
  
  // Normalize messages for Anthropic format
  const normalizedMessages = otherMessages.map(m => {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    
    // If content is already an array (block format), use as-is
    if (Array.isArray(m.content)) {
      return { role, content: m.content };
    }
    
    // If we have any block content in the conversation, wrap all strings in text blocks for consistency
    if (hasBlockContent && typeof m.content === 'string') {
      return { role, content: [{ type: 'text', text: m.content }] };
    }
    
    // For simple conversations without tool use, strings are fine
    return { role, content: m.content };
  });
  
  const body = {
    model,
    max_tokens: maxTokens,
    messages: normalizedMessages
  };
  
  if (systemMessage) {
    body.system = typeof systemMessage.content === 'string' 
      ? systemMessage.content 
      : systemMessage.content;
  }
  
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
  }
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  const responseTime = Date.now() - startTime;
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`[llm-service] Anthropic API error after ${responseTime}ms:`, error);
    throw new Error(`Error de Anthropic: ${error}`);
  }
  
  const data = await response.json();
  console.log(`[llm-service] Anthropic API completed: ${responseTime}ms, usage: input=${data.usage?.input_tokens || 'N/A'}, output=${data.usage?.output_tokens || 'N/A'}`);
  
  let content = '';
  let tool_calls = null;
  
  for (const block of data.content || []) {
    if (block.type === 'text') {
      content = block.text;
    } else if (block.type === 'tool_use') {
      if (!tool_calls) tool_calls = [];
      tool_calls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input)
        }
      });
    }
  }
  
  return {
    content,
    tool_calls,
    usage: {
      prompt_tokens: data.usage?.input_tokens,
      completion_tokens: data.usage?.output_tokens,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
    },
    model: data.model || model
  };
}

function buildVenueContext(venue, templates, plans) {
  const parts = [];
  
  parts.push(`# Información de ${venue.name || 'la Cabaña'}`);
  parts.push('');
  
  if (venue.address) {
    parts.push(`## Ubicación`);
    parts.push(`Dirección: ${venue.address}`);
    if (venue.city) parts.push(`Ciudad: ${venue.city}`);
    if (venue.department) parts.push(`Departamento: ${venue.department}`);
    if (venue.address_reference) parts.push(`Referencia: ${venue.address_reference}`);
    if (venue.waze_link) parts.push(`Link de Waze: ${venue.waze_link}`);
    if (venue.google_maps_link) parts.push(`Link de Google Maps: ${venue.google_maps_link}`);
    parts.push('');
  }
  
  if (venue.wifi_ssid || venue.wifi_password) {
    parts.push(`## WiFi`);
    if (venue.wifi_ssid) parts.push(`Red: ${venue.wifi_ssid}`);
    if (venue.wifi_password) parts.push(`Contraseña: ${venue.wifi_password}`);
    parts.push('');
  }
  
  if (venue.whatsapp) {
    parts.push(`## Contacto`);
    parts.push(`WhatsApp: ${venue.whatsapp}`);
    if (venue.instagram) parts.push(`Instagram: ${venue.instagram}`);
    parts.push('');
  }
  
  if (venue.delivery_info) {
    parts.push(`## Domicilios`);
    parts.push(venue.delivery_info);
    parts.push('');
  }
  
  if (venue.venue_info) {
    parts.push(`## Información General`);
    parts.push(venue.venue_info);
    parts.push('');
  }
  
  if (plans && plans.length > 0) {
    parts.push(`## Planes Disponibles`);
    for (const plan of plans) {
      parts.push(`### ${plan.name}`);
      if (plan.description) parts.push(plan.description);
      if (plan.type) parts.push(`Tipo: ${plan.type}`);
      if (plan.adult_price) parts.push(`Precio adulto: $${plan.adult_price}`);
      if (plan.child_price) parts.push(`Precio niño: $${plan.child_price}`);
      if (plan.check_in_time) parts.push(`Check-in: ${plan.check_in_time}`);
      if (plan.check_out_time) parts.push(`Check-out: ${plan.check_out_time}`);
      if (plan.min_guests) parts.push(`Mínimo de personas: ${plan.min_guests}`);
      if (plan.max_capacity) parts.push(`Capacidad máxima: ${plan.max_capacity}`);
      if (plan.food_almuerzo) parts.push(`Almuerzo: ${plan.food_almuerzo}`);
      if (plan.food_cena) parts.push(`Cena: ${plan.food_cena}`);
      parts.push('');
    }
  }
  
  if (templates && templates.length > 0) {
    parts.push(`## Respuestas Predefinidas`);
    for (const template of templates) {
      parts.push(`### ${template.name}`);
      parts.push(template.content);
      parts.push('');
    }
  }
  
  return parts.join('\n');
}

function buildSystemPrompt(venue, context, contactInfo = null) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const dayOfWeek = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][now.getDay()];
  const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const currentDateStr = `${currentDay} de ${monthNames[now.getMonth()]} de ${currentYear}`;
  const isoDate = now.toISOString().split('T')[0];
  
  const contactSection = contactInfo 
    ? `\nINFORMACIÓN DEL CLIENTE:\n- Tipo de contacto: ${contactInfo.type === 'whatsapp' ? 'WhatsApp' : 'Instagram'}\n- Contacto: ${contactInfo.value}\n`
    : '';
  
  return `Eres un asistente virtual amable y servicial de "${venue.name || 'la Cabaña'}". Tu trabajo es responder preguntas de clientes potenciales y huéspedes sobre la propiedad.

FECHA ACTUAL: Hoy es ${dayOfWeek}, ${currentDateStr} (${isoDate}).
${contactSection}
REGLAS IMPORTANTES:
1. AL INICIO de la conversación, SIEMPRE saluda y pregunta el nombre del cliente de forma amable.
2. Responde basándote en la información disponible. Usa las herramientas para consultar detalles específicos.
3. Sé conciso pero amable. Usa un tono cálido y profesional.
4. Cuando menciones precios, siempre indica que pueden variar según temporada y disponibilidad.
5. Responde siempre en español.

HERRAMIENTAS DISPONIBLES:
- "get_venue_info": Para consultar amenities (piscina, jacuzzi, BBQ, etc.), ubicación, WiFi
- "get_plans": Para consultar planes disponibles con precios y lo que incluyen
- "check_availability": Para verificar disponibilidad en fechas específicas
- "create_estimate": Para crear una cotización cuando el cliente quiera reservar

FLUJO DE CONVERSACIÓN:
1. Si el cliente NO ha dado su nombre, pregúntalo amablemente al inicio
2. Si preguntan por amenidades (piscina, jacuzzi, parrilla, etc.), USA la herramienta get_venue_info
3. Si preguntan por planes o precios, USA la herramienta get_plans
4. Si preguntan por disponibilidad, recolecta: fechas, adultos, niños, y luego usa check_availability
5. Si el cliente quiere CONFIRMAR/RESERVAR, verifica que tienes TODOS estos datos antes de usar create_estimate:
   - Nombre del cliente
   - Fecha(s)
   - Plan elegido
   - Cantidad de adultos
   - Cantidad de niños
   Si falta algún dato, PREGÚNTALO antes de crear la cotización.

INTERPRETACIÓN DE FECHAS:
- SIEMPRE usa la fecha actual (${isoDate}) como referencia para interpretar fechas relativas.
- Si el cliente dice "el 12 de febrero", asume el año ${currentYear} o ${currentYear + 1} (el más próximo en el futuro).
- Si dice "el próximo sábado", calcula la fecha del próximo sábado desde hoy.
- Si dice "este fin de semana", calcula el próximo sábado y domingo.
- NUNCA asumas fechas en el pasado. Todas las consultas deben ser para fechas futuras.

VERIFICACIÓN DE DISPONIBILIDAD:
- Cuando el cliente pregunte por disponibilidad, usa la herramienta check_availability.
- Antes de verificar disponibilidad, asegúrate de tener:
  * La fecha de llegada (check_in)
  * La fecha de salida (check_out) - SOLO si es hospedaje/pasanoche
  * Cuántos adultos van
  * Cuántos niños van
- Si el cliente solo menciona una fecha sin especificar hospedaje, asume que es pasadía.
- Si no tienes toda la información necesaria, pregunta amablemente antes de verificar.

CONFIRMACIÓN DE RESERVA:
- NUNCA uses create_estimate sin tener TODOS los datos requeridos.
- Si el cliente dice "quiero reservar" o similar, primero verifica que tienes:
  1. Nombre del cliente
  2. Fecha de llegada
  3. Plan seleccionado
  4. Número de adultos
  5. Número de niños (puede ser 0)
- Si falta información, pregunta específicamente por lo que falta.
- Una vez creada la cotización, confirma los detalles al cliente.

${context}`;
}

function getNextAvailableDates(existingAccommodations, fromDate, options = {}) {
  const { numDays = 30, preferWeekends = false, stayLength = 1 } = options;
  const availableDates = [];
  const checkDate = new Date(fromDate);
  
  for (let i = 0; i < numDays && availableDates.length < 5; i++) {
    checkDate.setDate(checkDate.getDate() + 1);
    const checkDay = new Date(checkDate.getUTCFullYear(), checkDate.getUTCMonth(), checkDate.getUTCDate());
    const isWeekend = checkDate.getDay() === 0 || checkDate.getDay() === 6;
    
    // If preferring weekends, skip weekdays
    if (preferWeekends && !isWeekend) {
      continue;
    }
    
    // Check if the entire stay period is available
    let isAvailable = true;
    for (let dayOffset = 0; dayOffset < stayLength && isAvailable; dayOffset++) {
      const stayDate = new Date(checkDay);
      stayDate.setDate(stayDate.getDate() + dayOffset);
      
      for (const acc of existingAccommodations) {
        const accDate = new Date(acc.date);
        const durationSeconds = parseInt(acc.duration) || 43200;
        const accEndDate = new Date(accDate.getTime() + durationSeconds * 1000);
        
        const accStartDay = new Date(accDate.getUTCFullYear(), accDate.getUTCMonth(), accDate.getUTCDate());
        const accEndDay = new Date(accEndDate.getUTCFullYear(), accEndDate.getUTCMonth(), accEndDate.getUTCDate());
        
        if (accStartDay <= stayDate && accEndDay >= stayDate) {
          isAvailable = false;
          break;
        }
      }
    }
    
    if (isAvailable) {
      const dayOfWeek = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][checkDate.getDay()];
      availableDates.push({
        date: checkDate.toISOString().split('T')[0],
        day_of_week: dayOfWeek,
        is_weekend: isWeekend
      });
    }
  }
  
  // If preferring weekends but didn't find enough, also get some weekday alternatives
  if (preferWeekends && availableDates.length < 3) {
    const weekdayAlternatives = getNextAvailableDates(existingAccommodations, fromDate, { 
      numDays, 
      preferWeekends: false, 
      stayLength 
    });
    for (const alt of weekdayAlternatives) {
      if (!availableDates.find(d => d.date === alt.date)) {
        availableDates.push(alt);
        if (availableDates.length >= 5) break;
      }
    }
  }
  
  return availableDates;
}

const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Verifica la disponibilidad de la cabaña para fechas específicas y cantidad de personas. Usar cuando el cliente pregunte si hay disponibilidad.',
      parameters: {
        type: 'object',
        properties: {
          check_in: {
            type: 'string',
            description: 'Fecha de llegada en formato YYYY-MM-DD'
          },
          check_out: {
            type: 'string',
            description: 'Fecha de salida en formato YYYY-MM-DD. Si es pasadía, usar la misma fecha que check_in.'
          },
          adults: {
            type: 'integer',
            description: 'Número de adultos'
          },
          children: {
            type: 'integer',
            description: 'Número de niños'
          }
        },
        required: ['check_in', 'adults']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_venue_info',
      description: 'Obtiene información detallada del venue/cabaña incluyendo amenities, ubicación, WiFi, y otras características. Usar cuando el cliente pregunte sobre piscina, jacuzzi, parrilla, u otras amenidades.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_plans',
      description: 'Obtiene todos los planes disponibles con sus precios, capacidades, horarios, comidas incluidas y amenities específicos de cada plan.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_estimate',
      description: 'Crea una cotización/reserva tentativa cuando el cliente confirma su interés. Solo usar cuando tienes TODOS los datos requeridos: nombre del cliente, fecha check_in, plan, adultos, niños.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: {
            type: 'string',
            description: 'Nombre completo del cliente'
          },
          plan_name: {
            type: 'string',
            description: 'Nombre del plan seleccionado (pasadía, pasanoche, hospedaje, etc.)'
          },
          check_in: {
            type: 'string',
            description: 'Fecha de llegada en formato YYYY-MM-DD'
          },
          check_out: {
            type: 'string',
            description: 'Fecha de salida en formato YYYY-MM-DD. Si es pasadía, usar la misma fecha que check_in.'
          },
          adults: {
            type: 'integer',
            description: 'Número de adultos'
          },
          children: {
            type: 'integer',
            description: 'Número de niños'
          },
          notes: {
            type: 'string',
            description: 'Notas adicionales o solicitudes especiales del cliente'
          }
        },
        required: ['customer_name', 'plan_name', 'check_in', 'adults']
      }
    }
  }
];

module.exports = {
  AI_MODELS,
  CHAT_TOOLS,
  getModelConfig,
  getApiKeyForProvider,
  callLLMByCode,
  callLLM,
  buildVenueContext,
  buildSystemPrompt,
  getNextAvailableDates
};
