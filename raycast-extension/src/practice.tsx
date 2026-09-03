import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  LocalStorage,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultSettings,
  generatePhrases,
  metrics,
  newSession,
  Session,
  Source,
  SourceSettings,
  sourceTitles,
} from "./logic";

const STORAGE_KEY = "ngram-type-state";

type SavedState = {
  source: Source;
  settings: Record<Source, SourceSettings>;
  customWords: string[];
  sessions: Record<Source, Session>;
};

function initialState(): SavedState {
  const settings = defaultSettings();
  const sessions = {} as Record<Source, Session>;
  (Object.keys(sourceTitles) as Source[]).forEach((source) => {
    sessions[source] = newSession(source, settings[source], []);
  });
  return { source: "bigrams", settings, customWords: [], sessions };
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

function phraseMarkdown(phrase: string) {
  return phrase.replace(/[\\`*_{}[\]()#+.!|>]/g, "\\$&");
}

export default function Practice() {
  const [state, setState] = useState(initialState);
  const [loaded, setLoaded] = useState(false);
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [currentMetrics, setCurrentMetrics] = useState(metrics("", "", null));
  const [status, setStatus] = useState("Start typing when ready");
  const completing = useRef(false);
  const session = state.sessions[state.source];
  const expected = session?.phrases[session.phraseIndex] ?? "";
  const navigation = useNavigation();

  useEffect(() => {
    LocalStorage.getItem<string>(STORAGE_KEY).then((raw) => {
      try {
        const saved = raw ? (JSON.parse(raw) as SavedState) : undefined;
        if (saved?.settings && saved?.sessions && sourceTitles[saved.source]) {
          const fresh = initialState();
          setState({
            ...fresh,
            ...saved,
            settings: { ...fresh.settings, ...saved.settings },
            sessions: { ...fresh.sessions, ...saved.sessions },
            customWords: saved.customWords ?? [],
          });
        }
      } catch {
        // Ignore corrupt local state and start a fresh session.
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) void LocalStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [loaded, state]);

  useEffect(() => {
    setTyped("");
    setStartedAt(null);
    setCurrentMetrics(metrics(expected, "", null));
    setStatus(
      expected ? "Start typing when ready" : "Add custom words in Settings",
    );
    completing.current = false;
  }, [state.source, expected]);

  const averageWPM = useMemo(
    () => average(session?.wpms ?? []),
    [session?.wpms],
  );

  function resetPhrase() {
    setTyped("");
    setStartedAt(null);
    setCurrentMetrics(metrics(expected, "", null));
    setStatus("Phrase reset");
    completing.current = false;
  }

  function finishPhrase(value: string, beganAt: number) {
    if (completing.current || !expected) return;
    completing.current = true;
    const result = metrics(expected, value.trimEnd(), beganAt);
    const sourceSettings = state.settings[state.source];

    if (
      result.wpm < sourceSettings.minimumWPM ||
      result.accuracy < sourceSettings.minimumAccuracy
    ) {
      void showToast({
        style: Toast.Style.Failure,
        title: "Try again",
        message: `${result.wpm} WPM · ${result.accuracy}% accuracy`,
      });
      setCurrentMetrics(result);
      setTyped("");
      setStartedAt(null);
      setStatus(
        `Minimum: ${sourceSettings.minimumWPM} WPM · ${sourceSettings.minimumAccuracy}%`,
      );
      completing.current = false;
      return;
    }

    setState((previous) => {
      const current = previous.sessions[previous.source];
      const wpms =
        current.phraseIndex === 0
          ? [result.wpm]
          : [...current.wpms, result.wpm];
      if (current.phraseIndex + 1 < current.phrases.length) {
        return {
          ...previous,
          sessions: {
            ...previous.sessions,
            [previous.source]: {
              ...current,
              phraseIndex: current.phraseIndex + 1,
              wpms,
            },
          },
        };
      }
      const phrases = generatePhrases(
        previous.source,
        previous.settings[previous.source],
        previous.customWords,
      );
      return {
        ...previous,
        sessions: {
          ...previous.sessions,
          [previous.source]: { phrases, phraseIndex: 0, wpms },
        },
      };
    });
    setCurrentMetrics(result);
    setTyped("");
    setStartedAt(null);
    setStatus("Great! Next phrase");
    void showToast({
      style: Toast.Style.Success,
      title: "Phrase complete",
      message: `${result.wpm} WPM · ${result.accuracy}% accuracy`,
    });
  }

  function handleChange(value: string) {
    const next = value.trimStart();
    if (!next) {
      resetPhrase();
      return;
    }
    const beganAt = startedAt ?? Date.now();
    if (!startedAt) setStartedAt(beganAt);
    setTyped(next);
    const result = metrics(expected, next, beganAt);
    setCurrentMetrics(result);
    setStatus(
      expected.startsWith(next)
        ? "Keep going"
        : "Mistake — correct it or reset",
    );
    if (next.trimEnd() === expected) finishPhrase(next, beganAt);
  }

  function changeSource(value: string) {
    if (value in sourceTitles)
      setState((previous) => ({ ...previous, source: value as Source }));
  }

  function saveSettings(
    source: Source,
    sourceSettings: SourceSettings,
    customWords: string[],
  ) {
    setState((previous) => {
      const settings = { ...previous.settings, [source]: sourceSettings };
      const sessions = {
        ...previous.sessions,
        [source]: newSession(source, sourceSettings, customWords),
      };
      return { source, settings, customWords, sessions };
    });
    navigation.pop();
  }

  if (!loaded) return null;

  const hasPhrase = Boolean(expected);
  return (
    <List
      navigationTitle={`${sourceTitles[state.source]} · Lesson ${session.phraseIndex + 1}/${session.phrases.length || 0}`}
      searchBarPlaceholder={
        hasPhrase ? "Type the phrase…" : "Add custom words in Settings"
      }
      searchText={typed}
      onSearchTextChange={handleChange}
      filtering={false}
      isShowingDetail
      searchBarAccessory={
        <List.Dropdown
          tooltip="Dataset"
          value={state.source}
          onChange={changeSource}
        >
          {(Object.keys(sourceTitles) as Source[]).map((value) => (
            <List.Dropdown.Item
              key={value}
              value={value}
              title={sourceTitles[value]}
            />
          ))}
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <Action
            title="Reset Phrase"
            icon={Icon.ArrowClockwise}
            onAction={resetPhrase}
          />
          <Action.Push
            title="Settings"
            icon={Icon.Gear}
            target={
              <SettingsForm
                source={state.source}
                settings={state.settings[state.source]}
                customWords={state.customWords}
                onSave={saveSettings}
              />
            }
          />
          {hasPhrase && (
            <Action.CopyToClipboard title="Copy Phrase" content={expected} />
          )}
        </ActionPanel>
      }
    >
      <List.Item
        title="Typing Practice"
        subtitle={hasPhrase ? status : "Open Settings to add words"}
        icon={Icon.Keyboard}
        accessories={[
          { text: `${session.phraseIndex + 1}/${session.phrases.length || 0}` },
        ]}
        detail={
          <List.Item.Detail
            markdown={
              hasPhrase
                ? `### Lesson ${session.phraseIndex + 1} / ${session.phrases.length}\n\n# ${phraseMarkdown(expected)}\n\n---\n\n${typed.length ? `${typed.length} / ${expected.length} characters` : "Type the phrase in the search bar above"}`
                : "# Ngram Type\n\nAdd custom words to start practicing."
            }
            metadata={
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.Label title="Status" text={status} />
                <List.Item.Detail.Metadata.Label
                  title="Accuracy"
                  text={`${currentMetrics.accuracy}%`}
                />
                <List.Item.Detail.Metadata.Label
                  title="Current WPM"
                  text={String(currentMetrics.wpm)}
                />
                <List.Item.Detail.Metadata.Label
                  title="Average WPM"
                  text={String(averageWPM)}
                />
                <List.Item.Detail.Metadata.Separator />
                <List.Item.Detail.Metadata.Label
                  title="Target"
                  text={`${state.settings[state.source].minimumWPM} WPM · ${state.settings[state.source].minimumAccuracy}%`}
                />
              </List.Item.Detail.Metadata>
            }
          />
        }
      />
    </List>
  );
}

function SettingsForm({
  source,
  settings,
  customWords,
  onSave,
}: {
  source: Source;
  settings: SourceSettings;
  customWords: string[];
  onSave: (
    source: Source,
    settings: SourceSettings,
    customWords: string[],
  ) => void;
}) {
  const onSubmit = (values: Form.Values) => {
    const selectedSource = values.source as Source;
    const custom = String(values.customWords ?? "")
      .split(/\s+/)
      .filter(Boolean);
    onSave(
      selectedSource,
      {
        scope:
          selectedSource === "custom_words" ? null : Number(values.scope) || 50,
        combination: Math.max(1, Number(values.combination) || 1),
        repetition: Math.max(1, Number(values.repetition) || 1),
        minimumWPM: Math.max(1, Number(values.minimumWPM) || 1),
        minimumAccuracy: Math.min(
          100,
          Math.max(1, Number(values.minimumAccuracy) || 1),
        ),
      },
      custom,
    );
  };

  return (
    <Form
      navigationTitle="Ngram Type Settings"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Settings"
            icon={Icon.CheckCircle}
            onSubmit={onSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="source" title="Source" defaultValue={source}>
        {(Object.keys(sourceTitles) as Source[]).map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={value}
            title={sourceTitles[value]}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="scope"
        title="Scope"
        defaultValue={String(settings.scope ?? 50)}
      >
        {[50, 100, 150, 200].map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={String(value)}
            title={`Top ${value}`}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="combination"
        title="Combination"
        defaultValue={String(settings.combination)}
      >
        {[1, 2, 3, 5, 10, 20, 40].map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={String(value)}
            title={String(value)}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="repetition"
        title="Repetition"
        defaultValue={String(settings.repetition)}
      >
        {[1, 2, 3, 5].map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={String(value)}
            title={String(value)}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="minimumWPM"
        title="Minimum WPM"
        defaultValue={String(settings.minimumWPM)}
      >
        {[20, 30, 40, 50, 60, 80, 100].map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={String(value)}
            title={String(value)}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="minimumAccuracy"
        title="Minimum accuracy"
        defaultValue={String(settings.minimumAccuracy)}
      >
        {[90, 95, 98, 100].map((value) => (
          <Form.Dropdown.Item
            key={value}
            value={String(value)}
            title={`${value}%`}
          />
        ))}
      </Form.Dropdown>
      <Form.TextArea
        id="customWords"
        title="Custom words"
        defaultValue={customWords.join("\n")}
        placeholder="Separate words with spaces or new lines"
      />
      <Form.Description
        title="Tip"
        text="Higher combination and lower repetition make practice harder."
      />
    </Form>
  );
}
