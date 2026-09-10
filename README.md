# Скорозвон → Битрикс24 Call Bridge

Сырая версия интеграции, которая сохраняет номер успешного дозвона в CRM и запускает повторный звонок с той же исходящей линии.

## Состояние

- Серверный контур развёрнут на `https://callbridge.188-225-39-38.sslip.io`.
- Ограниченный вебхук Битрикс24 проверен с правами `crm` и `call`; секрет хранится только в закрытом серверном env-файле.
- В лидах созданы служебные поля интеграции, новые лиды направляются в статус `NEW`.
- Приём событий и реальные звонки остаются заблокированными (`CALL_BRIDGE_ENABLED=false`) до настройки номеров и SIP-транка.
- Секреты задаются только в переменных окружения и не попадают в репозиторий или браузерный JavaScript.
- Боевой режим автоматически блокируется, если не настроены отдельные секреты входящего события и действия менеджера.

## Переменные окружения

```text
BITRIX24_WEBHOOK_URL=https://portal.bitrix24.ru/rest/user/token
SKOROZVON_WEBHOOK_SECRET=random-long-secret
MANAGER_ACTION_SECRET=random-long-secret
ALLOWED_CALLER_IDS=79031112233,79032223344
LINE_MAP_JSON={"79031112233":"reg151083","79032223344":"reg151084"}
BITRIX_LEAD_STATUS_ID=NEW
BITRIX_MANAGER_ID=123
BITRIX_FIELD_CLIENT_PHONE=UF_CRM_SKZ_CLIENT_PHONE
BITRIX_FIELD_SUCCESS_CALLER_ID=UF_CRM_SKZ_SUCCESS_CALLER_ID
BITRIX_FIELD_SUCCESS_LINE_ID=UF_CRM_SKZ_SUCCESS_LINE_ID
BITRIX_FIELD_SKOROZVON_CALL_ID=UF_CRM_SKZ_CALL_ID
BITRIX_FIELD_ACTUALIZER=UF_CRM_SKZ_ACTUALIZER
```

## API

### `POST /api/skorozvon-event`

Принимает успешный звонок и создаёт/обновляет CRM-сущность.

```json
{
  "call_id": "call-1042",
  "client_phone": "+79991234567",
  "successful_caller_id": "+79031112233",
  "entity_type": "lead",
  "result": "qualified"
}
```

### `POST /api/call`

Читает номер клиента и сохранённую линию из CRM, проверяет Caller ID по белому списку и инициирует звонок.

## Что требуется для production

1. Передать список номеров карусели и параметры SIP-транка Билайна.
2. Подключить билайновский SIP-транк к Asterisk/FreeSWITCH и разрешить только подтверждённые Caller ID.
3. Настроить отправку результата Скорозвона и сопоставление с CDR АТС.
4. Установить локальное приложение/кнопку в карточку лида.
5. Добавить постоянное хранилище аудита, повторов и идемпотентности.

Для транка с IP-авторизацией публичный IP сервера АТС должен быть добавлен оператором в список разрешённых. До этого SIP-вызовы не активируются.

## Развёртывание на сервере

- systemd unit: `skorozvon-call-bridge.service`
- каталог: `/opt/skorozvon-bitrix-call-bridge`
- внутренний адрес: `127.0.0.1:8790`
- публичный HTTPS: `https://callbridge.188-225-39-38.sslip.io`
- конфигурация Nginx: `/etc/nginx/sites-available/skorozvon-call-bridge`
- секреты: `/opt/skorozvon-bitrix-call-bridge/.env.production` с правами `0640 root:callbridge`

## Принятая production-схема с SIP-транком

1. Скорозвон отправляет исходящий вызов через собственную карусель в Asterisk/FreeSWITCH.
2. АТС фиксирует фактический Caller ID, телефон клиента и идентификатор SIP-сессии в CDR.
3. Событие успешного разговора сопоставляется с CDR и создаёт лид в статусе `NEW`.
4. В лид записываются номер успешного дозвона и идентификатор линии.
5. Кнопка менеджера запускает вызов через ту же АТС с сохранённым разрешённым Caller ID.

API Скорозвона v2 возвращает данные разговора, но в проверенной структуре исходящего звонка нет фактического номера карусели. Поэтому источником истины для номера является CDR собственной АТС.
