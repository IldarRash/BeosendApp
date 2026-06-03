import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "./api/client";
import { AppShell } from "./ui/AppShell";
import { StatCard } from "./ui/StatCard";

type HealthState =
  | { kind: "checking" }
  | { kind: "ok"; service: string }
  | { kind: "down"; reason: string };

function HealthBadge({ state }: { state: HealthState }): JSX.Element {
  if (state.kind === "checking") {
    return (
      <span className="health">
        <span className="dot" /> API: проверка…
      </span>
    );
  }
  if (state.kind === "ok") {
    return (
      <span className="health">
        <span className="dot dot--ok" /> API: ok · {state.service}
      </span>
    );
  }
  return (
    <span className="health">
      <span className="dot dot--down" /> API: недоступен
    </span>
  );
}

export function App(): JSX.Element {
  const api = useMemo(() => createApiClient(), []);
  const [health, setHealth] = useState<HealthState>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((res) => {
        if (!cancelled) setHealth({ kind: "ok", service: res.service });
      })
      .catch((err: unknown) => {
        if (!cancelled) setHealth({ kind: "down", reason: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <AppShell current="dashboard">
      <header className="page-head">
        <div>
          <h1>Обзор</h1>
          <p>
            Каркас админ-консоли BeoSand. Доменные экраны (группы, тренировки, рассылки) появятся
            следующими — здесь подтверждается живая связь с API.
          </p>
        </div>
        <HealthBadge state={health} />
      </header>

      <section className="grid">
        <StatCard label="Группы" value="—" hint="ожидает API" />
        <StatCard label="Тренировки (мес.)" value="—" hint="ожидает API" />
        <StatCard label="Заявки на корты" value="—" hint="ожидает API" />
        <StatCard label="Заполненность" value="—" hint="ожидает API" />
      </section>

      <div className="note">
        <h3>Заготовка, а не готовая консоль</h3>
        <p>
          Данные подставит <code>ApiClient</code> через контракты <code>@beosand/types</code>, когда
          появятся admin-эндпойнты и браузерная авторизация. Прайсы — всегда RSD, считаются на сервере.
        </p>
      </div>
    </AppShell>
  );
}
