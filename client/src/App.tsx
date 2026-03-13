import { useEffect, useMemo, useState } from "react";
import type { GamePhase, PromptKind, RoomView } from "@fellowship/shared";
import { Button } from "./components/ui/Button";
import { Card } from "./components/ui/Card";
import { PhaseTimer } from "./components/ui/PhaseTimer";
import { useRoomStore } from "./state/useRoomStore";

function App() {
  const { actions, error, reconnecting, room, status } = useRoomStore();
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  useEffect(() => {
    actions.initialize();
    void actions.reconnectFromStorage();
  }, [actions]);

  const phaseCopy = useMemo(
    () => getPhaseCopy(room?.phase, room?.round?.promptKind),
    [room?.phase, room?.round?.promptKind],
  );

  if (!room) {
    return (
      <main className="shell">
        <section className="hero">
          <div className="hero__copy">
            <span className="hero__eyebrow">Church fellowship word and Scripture gathering</span>
            <h1>Share a word, a verse, and a thoughtful guess.</h1>
            <p>
              Host from one screen, share the room code, and let everyone else join from phones or
              laptops for a warm fellowship challenge that alternates between mystery words and
              well-known Bible verses.
            </p>
            <div className="status-pill">
              <span className={`status-dot status-dot--${status}`} />
              {reconnecting ? "Restoring your seat..." : `Socket status: ${status}`}
            </div>
          </div>

          <div className="hero__panels">
            <Card>
              <h2>Create room</h2>
              <p>Open a room, welcome everyone in, and guide the next round together.</p>
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Host name" />
              </label>
              <Button wide onClick={() => void actions.createRoom(name)}>
                Host a game
              </Button>
            </Card>

            <Card>
              <h2>Join room</h2>
              <p>Reconnect automatically if your saved seat is still active on the server.</p>
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Player name" />
              </label>
              <label className="field">
                <span>Room code</span>
                <input
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                  maxLength={4}
                  placeholder="ABCD"
                />
              </label>
              <Button variant="secondary" wide onClick={() => void actions.joinRoom(roomCode, name)}>
                Join the room
              </Button>
            </Card>
          </div>
        </section>

        {error ? (
          <div className="toast" role="alert">
            <span>{error}</span>
            <Button variant="ghost" onClick={() => actions.clearError()}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </main>
    );
  }

  const me = room.players.find((player) => player.id === room.meId);
  const hostPlayer = room.players.find((player) => player.isHost);
  const participantPlayers = room.players.filter((player) => !player.isHost);
  const isHost = Boolean(me?.isHost);
  const isParticipantPlayPhase = !isHost && (room.phase === "submission" || room.phase === "voting");

  return (
    <main className="shell shell--game">
      <header className="topbar">
        <div className="topbar__identity">
          <span className="hero__eyebrow">{isHost ? "Host controls" : `Host: ${hostPlayer?.name ?? "Unknown"}`}</span>
          <div className="room-code-display">
            <span className="room-code-display__label">Room code</span>
            <strong>{room.code}</strong>
          </div>
        </div>
        <div className="topbar__actions">
          <span className="phase-tag">{phaseCopy.label}</span>
          {!isParticipantPlayPhase ? <PhaseTimer deadlineAt={room.round?.deadlineAt ?? null} /> : null}
          <Button variant="ghost" onClick={() => actions.disconnect()}>
            Leave
          </Button>
        </div>
      </header>

      <section className={`layout ${isParticipantPlayPhase ? "layout--single" : ""}`}>
        {!isParticipantPlayPhase ? (
          <aside className="sidebar">
            <Card className="scoreboard-card">
              <h2>Players</h2>
              <div className="score-list">
                {participantPlayers.map((player, index) => (
                  <div key={player.id} className={`score-row ${player.id === room.meId ? "score-row--me" : ""}`}>
                    <div>
                      <strong>
                        {index + 1}. {player.name}
                      </strong>
                      <span>{player.connected ? "Online" : "Reconnecting"}</span>
                    </div>
                    <div className="score-row__score">{player.score}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2>{isHost ? "Host panel" : "Round panel"}</h2>
              <p>{phaseCopy.description}</p>
              <div className="pill-grid">
                <span className="stat-pill">{participantPlayers.length} players</span>
                <span className="stat-pill">{room.settings.totalRounds} rounds</span>
              </div>
              {room.phase === "lobby" && room.canStart ? (
                <Button wide onClick={() => actions.startGame()}>
                  Start game
                </Button>
              ) : null}
              {room.canAdvance ? (
                <Button wide variant="secondary" onClick={() => actions.advance()}>
                  {getAdvanceLabel(room)}
                </Button>
              ) : null}
              {isHost ? (
                <Button
                  wide
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm("End this room and remove everyone from the session?")) {
                      actions.endRoom();
                    }
                  }}
                >
                  End room
                </Button>
              ) : null}
              <div className="host-summary">
                <span className="host-badge">{hostPlayer?.name ?? "Host"} is moderating</span>
              </div>
            </Card>
          </aside>
        ) : null}

        <section className="main-panel">
          <Card className={`round-card ${isParticipantPlayPhase ? "round-card--play-focus" : ""}`}>
            <div className={`round-header ${isParticipantPlayPhase ? "round-header--play-focus" : ""}`}>
              <div className={isParticipantPlayPhase ? "round-header__content round-header__content--play-focus" : ""}>
                <span className="hero__eyebrow">
                  {room.round ? `${room.round.promptLabel} · ${room.round.category}` : "Warmup"}
                </span>
                <h2 className={`round-prompt-text ${room.round?.promptKind === "bibleVerse" ? "round-prompt-text--verse" : ""}`}>
                  {room.round?.promptText ?? "Waiting in lobby"}
                </h2>
              </div>
              <div className={`round-header__meta ${isParticipantPlayPhase ? "round-header__meta--play-focus" : ""}`}>
                {isParticipantPlayPhase ? <PhaseTimer deadlineAt={room.round?.deadlineAt ?? null} /> : null}
                <div className="difficulty-pill">{room.round?.difficulty ?? "party"}</div>
              </div>
            </div>

            {room.phase === "lobby" ? <LobbyView room={room} /> : null}
            {room.phase === "submission" ? (
              isHost ? (
                <ModeratorView
                  title={room.round?.promptKind === "bibleVerse" ? "Waiting for Bible references" : "Waiting for player responses"}
                  body={
                    room.round?.promptKind === "bibleVerse"
                      ? "Players have up to 90 seconds to submit a book, chapter, and verse reference in BOOK: Chapter: verse format, and the round moves on as soon as every non-host player is ready."
                      : "Players have up to 90 seconds to submit a definition, and the round moves on as soon as every non-host player is ready."
                  }
                />
              ) : (
                <SubmissionView
                  key={`${room.code}-${room.roundNumber}`}
                  initialDefinition={room.round?.yourSubmission ?? ""}
                  onSubmit={(nextDefinition) => actions.submit(nextDefinition)}
                  room={room}
                />
              )
            ) : null}
            {room.phase === "voting" ? (
              isHost ? (
                <ModeratorView
                  title="Waiting for votes"
                  body={
                    room.round?.promptKind === "bibleVerse"
                      ? "Players are choosing the Bible reference they believe matches the verse. You can still move the round along whenever you need to."
                      : "Players are choosing the definition they believe is correct. You can still move the round along whenever you need to."
                  }
                />
              ) : room.round?.canVote ? (
                <VotingView room={room} onVote={(optionId) => actions.vote(optionId)} />
              ) : (
                <SolvedRoundView promptKind={room.round?.promptKind ?? "word"} />
              )
            ) : null}
            {room.phase === "reveal" ? (
              <RevealView room={room} />
            ) : null}
            {room.phase === "scoreboard" || room.phase === "finished" ? <ScoreboardView room={room} /> : null}
          </Card>
        </section>
      </section>

      {error ? (
        <div className="toast" role="alert">
          <span>{error}</span>
          <Button variant="ghost" onClick={() => actions.clearError()}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </main>
  );
}

function LobbyView({ room }: { room: RoomView }) {
  const participantPlayers = room.players.filter((player) => !player.isHost);

  return (
    <div className="phase-panel">
      <p className="lead">
        Gather at least two players, then start the game. The host guides the room while everyone
        else alternates between mystery words and well-known Bible verses, writing thoughtful
        responses that challenge the group.
      </p>
      <div className="pill-grid">
        <span className="stat-pill">{participantPlayers.length} players joined</span>
        <span className="stat-pill">{room.settings.totalRounds} rounds</span>
        <span className="stat-pill">+2 real answer</span>
        <span className="stat-pill">+1 per player vote</span>
      </div>
    </div>
  );
}

function ModeratorView({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <div className="phase-panel">
      <div className="moderator-card">
        <span className="hero__eyebrow">Host view</span>
        <h3>{title}</h3>
        <p className="lead">{body}</p>
      </div>
    </div>
  );
}

function SubmissionView({
  initialDefinition,
  onSubmit,
  room,
}: {
  initialDefinition: string;
  onSubmit: (value: string) => void;
  room: RoomView;
}) {
  const [definition, setDefinition] = useState(initialDefinition);
  const roundKind = room.round?.promptKind ?? "word";
  const submissionCopy = getSubmissionCopy(roundKind);

  return (
    <div className="phase-panel phase-panel--play-focus">
      <p className="lead lead--play-focus">{submissionCopy.description}</p>
      {room.round?.hasSolved ? (
        <div className="moderator-card">
          <span className="hero__eyebrow">Correct answer locked in</span>
          <h3>Nice work. You earned +2 points.</h3>
          <p className="lead">
            Your answer counts as the real answer for this round, so it will stay hidden and you
            will skip the voting step.
          </p>
          <span className="stat-pill">
            {room.round?.submissionsCount}/{room.round?.playersNeeded} submitted
          </span>
        </div>
      ) : (
        <>
          <label className="field field--play-focus">
            <span>{submissionCopy.label}</span>
            <textarea
              value={definition}
              onChange={(event) => setDefinition(event.target.value)}
              placeholder={submissionCopy.placeholder}
              rows={5}
            />
          </label>
          <div className="phase-footer">
            <span className="stat-pill">
              {room.round?.submissionsCount}/{room.round?.playersNeeded} submitted
            </span>
            <Button className={room.round?.hasSubmitted ? "button--update" : ""} onClick={() => onSubmit(definition)}>
              {room.round?.hasSubmitted ? "Update response" : "Send response"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function VotingView({
  onVote,
  room,
}: {
  onVote: (optionId: string) => void;
  room: RoomView;
}) {
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const selectedOptionId = room.round?.selectedOptionId ?? pendingOptionId;
  const promptKind = room.round?.promptKind ?? "word";

  return (
    <div className="phase-panel phase-panel--play-focus">
      <p className="lead lead--play-focus">{getVotingCopy(promptKind)}</p>
      <div className="option-list option-list--compact">
        {room.round?.options.map((option) => (
          <button
            key={option.id}
            className={`option-card ${selectedOptionId === option.id ? "option-card--selected" : ""}`}
            onClick={() => {
              setPendingOptionId(option.id);
              onVote(option.id);
            }}
          >
            <span className="option-card__label">
              {selectedOptionId === option.id ? "Selected for now" : "Tap to choose"}
            </span>
            <strong>{option.text}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function SolvedRoundView({ promptKind }: { promptKind: PromptKind }) {
  return (
    <div className="phase-panel">
      <div className="moderator-card">
        <span className="hero__eyebrow">Solved during submission</span>
        <h3>You already earned +2 points.</h3>
        <p className="lead">
          Your {promptKind === "bibleVerse" ? "reference" : "definition"} matched the real answer,
          so you do not vote this turn.
        </p>
      </div>
    </div>
  );
}

function RevealView({ room }: { room: RoomView }) {
  const promptKind = room.round?.promptKind ?? "word";

  return (
    <div className="phase-panel">
      <p className="lead">
        {room.phase === "finished"
          ? "Final standings are set. Thank you for playing together."
          : "Here is the reveal. Correct guesses earn two points, and every player who chose your answer earns you one point."}
      </p>
      <div className="option-list">
        {room.round?.options.map((option) => (
          <div
            key={option.id}
            className={`option-card option-card--reveal ${
              option.isCorrect ? "option-card--correct" : ""
            }`}
          >
            <span className="option-card__label">
              {option.isCorrect ? getCorrectOptionLabel(promptKind) : option.authorId ? getPlayerOptionLabel(promptKind) : "Option"}
            </span>
            <strong>{option.text}</strong>
            {typeof option.voteCount === "number" ? <span>{option.voteCount} vote(s)</span> : null}
          </div>
        ))}
      </div>

      {room.round?.reveal ? (
        <div className="delta-list">
          {room.round.reveal.scoreDeltas.length === 0 ? (
            <span className="stat-pill">No points this round</span>
          ) : (
            room.round.reveal.scoreDeltas.map((delta, index) => {
              const player = room.players.find((candidate) => candidate.id === delta.playerId);
              return (
                <span className="stat-pill" key={`${delta.playerId}-${index}`}>
                  {player?.name ?? "Player"} +{delta.points}
                </span>
              );
            })
          )}
        </div>
      ) : null}

      {room.phase === "finished" ? (
        <div className="winner-banner">
          Winners:{" "}
          {room.players
            .filter((player) => room.winnerIds.includes(player.id))
            .map((player) => player.name)
            .join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function ScoreboardView({ room }: { room: RoomView }) {
  const participants = room.players.filter((player) => !player.isHost);
  const rankedPlayers = [...participants].sort(
    (left, right) => right.score - left.score || left.name.localeCompare(right.name),
  );

  return (
    <div className="phase-panel">
      <div className="scoreboard-stage">
        <div>
          <span className="hero__eyebrow">
            {room.phase === "finished" ? "Final standings" : `Round ${room.roundNumber} complete`}
          </span>
          <h3>{room.phase === "finished" ? "Thanks for gathering and playing." : "Current scoreboard"}</h3>
          <p className="lead">
            {room.phase === "finished"
              ? "Here are the final results for everyone who played this fellowship word-and-Scripture challenge."
              : "The host can start the next round whenever everyone is ready."}
          </p>
        </div>

        <div className="scoreboard-stage__list">
          {rankedPlayers.map((player, index) => (
            <div
              key={player.id}
              className={`scoreboard-stage__row ${player.id === room.meId ? "scoreboard-stage__row--me" : ""}`}
            >
              <div className="scoreboard-stage__rank">{index + 1}</div>
              <div className="scoreboard-stage__player">
                <strong>{player.name}</strong>
                <span>{player.connected ? "Ready to continue" : "Reconnecting"}</span>
              </div>
              <div className="scoreboard-stage__points">{player.score} pts</div>
            </div>
          ))}
        </div>

        {room.phase === "finished" ? (
          <div className="winner-banner">
            Winners:{" "}
            {rankedPlayers
              .filter((player) => room.winnerIds.includes(player.id))
              .map((player) => player.name)
              .join(", ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function getPhaseCopy(phase?: GamePhase, promptKind: PromptKind = "word") {
  switch (phase) {
    case "submission":
      return {
        label: "Write responses",
        description:
          promptKind === "bibleVerse"
            ? "Players get 90 seconds to submit a Bible reference, or the phase ends early when every player submits."
            : "Players get 90 seconds to submit a definition, or the phase ends early when every player submits.",
      };
    case "voting":
      return {
        label: "Make your guess",
        description:
          promptKind === "bibleVerse"
            ? "Choose the Bible reference you believe matches the verse before the timer ends."
            : "Choose the definition you believe is real before the timer ends.",
      };
    case "reveal":
      return {
        label: "Reveal",
        description: "See the correct answer, the shared responses, and the points from this round.",
      };
    case "scoreboard":
      return {
        label: "Scoreboard",
        description: "View the current standings together before the host starts the next round.",
      };
    case "finished":
      return {
        label: "Final results",
        description: "The match is over. You can leave the room and begin a new gathering anytime.",
      };
    case "lobby":
    default:
      return {
        label: "Lobby",
        description: "Waiting for the host to welcome everyone and begin the first round.",
      };
  }
}

function getSubmissionCopy(promptKind: PromptKind) {
  if (promptKind === "bibleVerse") {
    return {
      description:
        "Read the verse carefully and submit the book, chapter, and verse you want the room to believe is correct. Use BOOK: Chapter: verse format.",
      label: "Your Bible reference",
      placeholder: "John: 3:16",
    };
  }

  return {
    description:
      "Write a convincing definition for the mystery word. Avoid using the word itself or copying the real definition.",
    label: "Your response",
    placeholder: "A thoughtful description that sounds real to the rest of the room...",
  };
}

function getVotingCopy(promptKind: PromptKind): string {
  return promptKind === "bibleVerse"
    ? "Review the shared references below and tap the one you believe matches the verse."
    : "Review the shared choices below and tap the definition you believe is the real one.";
}

function getCorrectOptionLabel(promptKind: PromptKind): string {
  return promptKind === "bibleVerse" ? "Correct reference" : "Correct definition";
}

function getPlayerOptionLabel(promptKind: PromptKind): string {
  return promptKind === "bibleVerse" ? "Player reference" : "Player definition";
}

function getAdvanceLabel(room: RoomView): string {
  switch (room.phase) {
    case "submission":
      return "Move to voting";
    case "voting":
      return "Reveal answers";
    case "reveal":
      return "Show scoreboard";
    case "scoreboard":
      return room.roundNumber >= room.totalRounds ? "Show final results" : "Start next round";
    default:
      return "Host advance";
  }
}

export default App;
