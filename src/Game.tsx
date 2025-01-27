import { useEffect, useRef, useState } from "react";
import { Row, RowState } from "./Row";
import dictionary from "./dictionary.json";
import { Clue, clue, describeClue, violation } from "./clue";
import { Keyboard } from "./Keyboard";
import targetList from "./targets.json";
import { dictionarySet, Difficulty, gameName, pick, seed, speak, urlParam } from "./util";
import { decode, encode } from "./base64";

enum GameState {
    Playing,
    Won,
    Lost,
}

interface GameProps {
    maxGuesses: number;
    hidden: boolean;
    difficulty: Difficulty;
    colorBlind: boolean;
    keyboardLayout: string;
}

const targets = targetList.slice(0, targetList.indexOf("murky") + 1); // Words no rarer than this one
const minLength = 4;
const defaultLength = 5;
const maxLength = 11;
const limitLength = (n: number) => (n >= minLength && n <= maxLength ? n : defaultLength);

function randomTarget(wordLength: number): string {
    const eligible = targets.filter((word) => word.length === wordLength);
    let candidate: string;
    do {
        candidate = pick(eligible);
    } while (/\*/.test(candidate));
    return candidate;
}

function getChallengeUrl(target: string): string {
    return window.location.origin + window.location.pathname + "?challenge=" + encode(target);
}

let initChallenge = "";
let challengeError = false;
try {
    initChallenge = decode(urlParam("challenge") ?? "").toLowerCase();
} catch (e) {
    console.warn(e);
    challengeError = true;
}
if (initChallenge && !dictionarySet.has(initChallenge)) {
    initChallenge = "";
    challengeError = true;
}

function parseUrlGameNumber(): number {
    const gameParam = urlParam("game");
    if (!gameParam) return 1;
    const gameNumber = Number(gameParam);
    return gameNumber >= 1 && gameNumber <= 1000 ? gameNumber : 1;
}

function Game(props: GameProps) {
    const [gameState, setGameState] = useState(GameState.Playing);
    const [guesses, setGuesses] = useState<string[]>([]);
    const [currentGuess, setCurrentGuess] = useState<string>("");
    const [challenge, setChallenge] = useState<string>(initChallenge);
    const [wordLength, setWordLength] = useState(6);
    const [gameNumber, setGameNumber] = useState(parseUrlGameNumber());
    const [target, setTarget] = useState("celtic");
    const [hint, setHint] = useState<string>(
        challengeError ? `Invalid challenge string, playing random game.` : `Make your first guess!`
    );
    const currentSeedParams = () => `?seed=${seed}&length=${wordLength}&game=${gameNumber}`;
    useEffect(() => {
        if (seed) {
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname + currentSeedParams()
            );
        }
    }, [wordLength, gameNumber]);
    const tableRef = useRef<HTMLTableElement>(null);
    const startNextGame = () => {
        if (challenge) {
            // Clear the URL parameters:
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        setChallenge("");
        const newWordLength = limitLength(wordLength);
        setWordLength(newWordLength);
        setTarget(randomTarget(newWordLength));
        setHint("");
        setGuesses([]);
        setCurrentGuess("");
        setGameState(GameState.Playing);
        setGameNumber((x) => x + 1);
    };

    async function share(copiedHint: string, text?: string) {
        const url = seed
            ? window.location.origin + window.location.pathname + currentSeedParams()
            : getChallengeUrl(target);
        const body = url + (text ? "\n\n" + text : "");
        if (
            /android|iphone|ipad|ipod|webos/i.test(navigator.userAgent) &&
            !/firefox/i.test(navigator.userAgent)
        ) {
            try {
                await navigator.share({ text: body });
                return;
            } catch (e) {
                console.warn("navigator.share failed:", e);
            }
        }
        try {
            await navigator.clipboard.writeText(body);
            setHint(copiedHint);
            return;
        } catch (e) {
            console.warn("navigator.clipboard.writeText failed:", e);
        }
        setHint(url);
    }

    const onKey = (key: string) => {
        if (gameState !== GameState.Playing) {
            if (key === "Enter") {
            }
            return;
        }
        if (guesses.length === props.maxGuesses) return;
        if (/^[a-z]$/i.test(key)) {
            setCurrentGuess((guess) => (guess + key.toLowerCase()).slice(0, wordLength));
            tableRef.current?.focus();
            setHint("");
        } else if (key === "Backspace") {
            setCurrentGuess((guess) => guess.slice(0, -1));
            setHint("");
        } else if (key === "Enter") {
            if (currentGuess.length !== wordLength) {
                setHint("Too short");
                return;
            }
            if (!dictionary.includes(currentGuess)) {
                setHint("Not a valid word");
                return;
            }
            for (const g of guesses) {
                const c = clue(g, target);
                const feedback = violation(props.difficulty, c, currentGuess);
                if (feedback) {
                    setHint(feedback);
                    return;
                }
            }
            setGuesses((guesses) => guesses.concat([currentGuess]));
            setCurrentGuess((guess) => "");

            const gameOver = (verbed: string) =>
                `You ${verbed}! The answer was ${target.toUpperCase()}. We're going to TD Garden baby!!`;

            if (currentGuess === target) {
                setHint(gameOver("won"));
                setGameState(GameState.Won);
            } else if (guesses.length + 1 === props.maxGuesses) {
                setHint(gameOver("lost"));
                setGameState(GameState.Lost);
            } else {
                setHint("");
                speak(describeClue(clue(currentGuess, target)));
            }
        }
    };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!e.ctrlKey && !e.metaKey) {
                onKey(e.key);
            }
            if (e.key === "Backspace") {
                e.preventDefault();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [currentGuess, gameState]);

    let letterInfo = new Map<string, Clue>();
    const tableRows = Array(props.maxGuesses)
        .fill(undefined)
        .map((_, i) => {
            const guess = [...guesses, currentGuess][i] ?? "";
            const cluedLetters = clue(guess, target);
            const lockedIn = i < guesses.length;
            if (lockedIn) {
                for (const { clue, letter } of cluedLetters) {
                    if (clue === undefined) break;
                    const old = letterInfo.get(letter);
                    if (old === undefined || clue > old) {
                        letterInfo.set(letter, clue);
                    }
                }
            }
            return (
                <Row
                    key={i}
                    wordLength={wordLength}
                    rowState={
                        lockedIn
                            ? RowState.LockedIn
                            : i === guesses.length
                            ? RowState.Editing
                            : RowState.Pending
                    }
                    cluedLetters={cluedLetters}
                />
            );
        });

    return (
        <div className="Game" style={{ display: props.hidden ? "none" : "block" }}>
            <div className="Game-options"></div>
            <table className="Game-rows" tabIndex={0} aria-label="Table of guesses" ref={tableRef}>
                <tbody>{tableRows}</tbody>
            </table>
            <p
                role="alert"
                style={{
                    userSelect: /https?:/.test(hint) ? "text" : "none",
                    whiteSpace: "pre-wrap",
                    paddingTop: "16px",
                    paddingBottom: "16px",
                }}
            >
                {hint || `\u00a0`}
            </p>
            <Keyboard layout={props.keyboardLayout} letterInfo={letterInfo} onKey={onKey} />
            <p>
                {gameState !== GameState.Playing && (
                    <button
                        onClick={() => {
                            const emoji = props.colorBlind
                                ? ["⬛", "🟦", "🟧"]
                                : ["⬛", "🟨", "🟩"];
                            const score = gameState === GameState.Lost ? "X" : guesses.length;
                            share(
                                "Result copied to clipboard!",
                                `${gameName} ${score}/${props.maxGuesses}\n` +
                                    guesses
                                        .map((guess) =>
                                            clue(guess, target)
                                                .map((c) => emoji[c.clue ?? 0])
                                                .join("")
                                        )
                                        .join("\n")
                            );
                        }}
                    >
                        Share emoji results
                    </button>
                )}
            </p>
        </div>
    );
}

export default Game;
