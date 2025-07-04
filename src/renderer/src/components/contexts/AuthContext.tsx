import { getCurrentPort } from "@renderer/utils/getPort";
import {
	deleteExpiresAt,
	deleteRefreshToken,
	getExpiresAt,
	getRefreshToken,
	saveExpiresAt,
	saveRefreshToken,
} from "@renderer/utils/secure-tokens";
import { createContext, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthContextType } from "./types/context-types";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthContextProvider({
	children,
}: { children: React.ReactNode }) {
	const [user, setUser] = useState<any>(null);
	const [refreshSessionToken, setRefreshSessionToken] = useState<string | null>(
		null,
	);
	const [loading, setLoading] = useState(true);
	const navigate = useNavigate();

	// on mount, try to load auth token
	useEffect(() => {
		(async () => {
			const storedToken = await getRefreshToken();
			if (storedToken) {
				refreshSession(storedToken);
			}
		})();
	}, []);

	useEffect(() => {
		(async () => {
			setLoading(true);
			const storedToken = await getRefreshToken();
			const sessionExpiresAt = await getExpiresAt();
			if (!storedToken) return;
			// refresh token if session expires
			if (!sessionExpiresAt || sessionExpiresAt * 1000 < Date.now()) {
				await refreshSession(storedToken);
			} else {
				setRefreshSessionToken(storedToken);
				setLoading(false);
			}
		})();
	}, []);

	async function refreshSession(token: string) {
		const port = await getCurrentPort();
		const response = await fetch(`http://localhost:${port}/db/refresh-token`, {
			headers: {
				accessToken: token,
			},
		});
		const data = await response.json();
		if (data.session) {
			await saveRefreshToken(data.session.refresh_token);
			await saveExpiresAt(data.session.expires_at);
			setRefreshSessionToken(data.session.refresh_token);
			saveRefreshToken(data.session.refresh_token);
			const response = await fetch(
				`http://localhost:${port}/db/user/${data.session.user.id}`,
			);
			if (response.ok) {
				const userData = await response.json();
				setUser(userData[0]);
			} else {
				setUser(null);
			}
			setLoading(false);
		} else {
			checkSession();
			setRefreshSessionToken(token);
			setLoading(false);
		}
	}

	async function checkSession() {
		if (user) {
			console.log("User is logged");
			// if user is logged, check access
			checkAccess();
		} else {
			console.log("User is not logged");
			// if (pathname !== "/first-time") {
			// 	navigate("/first-time");
			// }
		}
	}

	async function checkAccess() {
		if (user) {
			if (user.tester === true) {
				console.log("User its a tester");
			} else {
				console.log("User is not a tester");
			}
		}
	}

	async function logout() {
		setUser(null);
		setRefreshSessionToken(null);
		await deleteRefreshToken();
		await deleteExpiresAt();
		window.electron.ipcRenderer.send("end-session");
		// remove this after beta
		navigate("/first-time");
	}

	return (
		<AuthContext.Provider
			value={{
				user,
				setUser,
				refreshSessionToken,
				setRefreshSessionToken,
				logout,
				checkSession,
				checkAccess,
				loading,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuthContext() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error(
			"useAuthContext must be used within an AuthContextProvider",
		);
	}
	return context;
}
