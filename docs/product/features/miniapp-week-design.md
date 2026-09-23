# Mini App: личная неделя и поиск занятий

Workflow: miniapp-week-design | revision 2 | running | Graph. Revision 2 follows the author's explicit correction: rollback via Git revert and redeploy, no runtime flag.

## Цель и согласованный дизайн
Автор одобрил визуальные макеты: «Моя неделя» для главной, «Когда играем?» для расписания. Реализовать читаемую недельную повестку, поиск тренировок и постоянную нижнюю навигацию. Сохранить все существующие сценарии, прозрачные статусы PR 74 и возможность отката. Production включение не входит в текущий этап.

База: origin/main 041c3cd, PR 74 уже merged. Отдельная ветка codex/miniapp-week-design. Исходная рабочая папка с пользовательскими изменениями не редактируется.

## Контракты и ограничения
Используем существующие client-records, training schedule, booking flow, court request, individual request, group subscription, profile. Backend владеет ценой, доступностью, правами и статусами. Не показываем номер неподтверждённого корта. Обрабатываем всю пагинацию или явно предлагаем загрузку; частичный список не выдаём за полный. Сохраняем RU/SR/EN, Telegram light/dark, deep links, Back/MainButton.

## Graph Spec
| ID | Owner | Input | Action | Evidence | State |
|---|---|---|---|---|---|
| A | root | current main, approved mocks | architecture and rollback contract | this brief | succeeded |
| B | UI writer | A, existing hooks/contracts | week home, schedule, records styles and navigation components | focused behavior checks | succeeded |
| C | root | A, existing router | router integration and reversible commit boundary | navigation tests; revert rehearsal at handoff | succeeded |
| D | root | B AND C | integrate, browser checks against mocks, full workspace checks | logs/screenshots; explicit limits below | succeeded |
| E | reviewer/root | D | bounded correctness/design review, fix material findings, document | fixes verified; visual fidelity limit below | succeeded |
| F | root | E | handoff working local preview, rollback procedure and evidence | PR + SHA + rollback rehearsal | ready |

Edges A→B,C; B AND C→D→E→F. B/C ownership does not overlap. Failed check returns to its owner for one evidence-led fix batch; rerun only affected checks, maximum two visual rounds. Remaining blocker documented. No protected deploy/merge/bot menu mutation executes without separate approval. Complete when approved surfaces work, classic rollback is tested, full required checks pass or exact blocker is reported, and handoff is reviewable.

## Откат коммита
Один самостоятельный feature commit содержит новый UI, навигацию, переводы и необходимые тесты. Runtime flags отсутствуют. Откат делается новым коммитом `git revert <feature SHA>` на актуальном main с последующим CI и redeploy; историю общей ветки не переписываем. Если GitHub использует squash, откатываем SHA squash-коммита; если merge commit — `git revert -m 1 <merge SHA>` после проверки первого родителя.

Изменений DB schema/migrations, API contract и bot URL нет. Down migration не нужна; записи/заявки, созданные после релиза, остаются совместимыми со старым UI. Нельзя откатывать PR 74 со статусами вместе с редизайном. Второй рубеж при срочной проблеме — redeploy предыдущего проверенного образа только Mini App, затем Git revert для синхронизации исходников. Уже открытые Telegram WebView нужно полностью закрыть и открыть повторно.

## Приёмка
- Week: реальные даты, статусы и причины; корректные loading/error/empty; видимость неполной пагинации.
- Schedule: дата/уровень/время, server-provided availability, существующий confirm/waitlist flow.
- Доступны индивидуальные заявки, месячные группы, аренда и профиль; нижние вкладки не растят стек бесконечно.
- Изолированный Git revert возвращает дерево затронутых product-файлов к базовому коммиту; точные SHA и команды фиксируются в handoff.
- Никаких изменений DB/API/bot routing и реальных сообщений.
- pnpm typecheck, lint, test, build across all workspaces.

## Проверки реализации (23 сентября 2026)
- `pnpm.cmd typecheck`: 12/12 задач, 7 из кэша.
- `pnpm.cmd lint`: 8/8 задач, 6 из кэша.
- `pnpm.cmd test`: 12/12 задач, 9 из кэша; Mini App — 172 теста. Во всех пакетах 2821 passed, 13 DB integration tests skipped без отдельной тестовой БД.
- `pnpm.cmd build`: 8/8 задач, 4 из кэша. Сохраняется предупреждение Vite о размере основного JS chunk.
- В браузере на локальном API fixture: запись → pending, полный слот → waitlist с позицией, скрытие повторной записи, история отказа с причиной, фильтр времени/пустой список, переход к аренде и профилю, сброс прокрутки между вкладками. Реальные API/Telegram сообщения не отправлялись.
- Вёрстка проверена при 390×844, 320×740 dark и 1280×900. Переполнение семи дней, контраст кнопок, высота навигации и лишние разделители исправлены.
- Ограничения: Telegram WebView на реальном телефоне ещё не проверен. Системный popup `input[type=date]` завершил вкладку встроенного браузера аварийно; его мобильная проверка остаётся release smoke-check. Автоматический pixel-diff с макетом не достиг порога fidelity; встроенные панели Telegram и фактические длинные статусы отличаются от иллюстративного макета. Сравнение не объявляется доказательством точного воспроизведения.
- Специализированные роли дизайн-review/documenter недоступны в сессии; ограниченную проверку выполнил root, документацию создал отдельный writer. Дизайн описан в `apps/miniapp/DESIGN.md`.

## Пошаговый runbook отката
1. Перед merge сохранить SHA текущего успешного deployment Mini App и окончательный SHA коммита редизайна на main (при squash он отличается от SHA ветки). Рекомендуется squash merge: один feature commit.
2. Для отката создать чистую ветку от актуального main:

```powershell
git fetch origin
git switch -c revert/miniapp-week-design origin/main
git revert --no-edit <SHA-редизайна-на-main>
```

При merge-коммите вместо последней команды применить `git revert -m 1 --no-edit <merge-SHA>` после проверки `git show --no-patch --pretty=raw <merge-SHA>`: первый родитель должен быть предыдущим main. Не использовать `reset --hard`/force push для общей ветки.

3. Запустить typecheck, lint, test, build; открыть rollback PR. Если появились конфликты с более поздними UI изменениями, сначала разрешить и проверить их. Нельзя автоматически отменять следующие несвязанные коммиты.
4. После merge rollback-коммита проверить обычный Railway deployment Mini App: репозиторий настроен на auto-deploy по main/watch paths; CI и deployment независимы. При срочном инциденте можно отдельно вернуть предыдущий успешный deployment Mini App, затем привести main к нему через revert. Выполнение production-операций — отдельный шаг владельца релиза.
5. Полностью закрыть и повторно открыть Mini App из того же бота. Проверить старое меню, профиль, аренду, расписание, «Мои записи и заявки», pending/confirmed/waitlisted/declined и ранее созданные записи. Проверить отсутствие ошибок загрузки JS.
6. DB rollback **не запускать**: этот PR не содержит миграций, схемы, API или bot URL изменений. Новые записи совместимы с UI из базы 041c3cd. PR 74 со статусами не отменять.

Локальная репетиция: после feature commit создаётся отдельный detached worktree, выполняется `git revert --no-edit <feature-SHA>` и сравнивается `HEAD^{tree}` с родительским tree. SHA и результат репетиции публикуются в PR/handoff, поскольку коммит не может содержать собственный SHA. Репетиция не затрагивает main и production.
