<script lang="ts">
	import { token, endpoint, online } from '$lib/stores'
	import { goto } from '$app/navigation'
	import { fly } from 'svelte/transition'

	// Props for component
	const { mode = 'login' } = $props<{
		mode?: 'login' | 'register'
	}>()

	// Form fields
	let email = $state('')
	let password = $state('')
	let username = $state('')

	let isLoading = $state(false)
	let errorMessage = $state('')

	// Auto-dismiss error messages
	$effect(() => {
		if (errorMessage) {
			const timer = setTimeout(() => {
				errorMessage = ''
			}, 3000)
			return () => clearTimeout(timer)
		}
	})

	// Configuration for different modes
	const configs = {
		login: {
			title: 'Sign in to access your media workspace',
			buttonText: 'Sign In',
			altMode: 'register',
			altText: 'Register',
			endpoint: '/auth/login',
			prepareData: () => ({ email, password }),
		},
		register: {
			title: 'Create a new account',
			buttonText: 'Create Account',
			altMode: 'login',
			altText: 'Sign In',
			endpoint: '/auth/register',
			prepareData: () => ({ email, password, username }),
		},
	} satisfies Record<
		string,
		{
			title: string
			buttonText: string
			altMode: string
			altText: string
			endpoint: string
			prepareData: () => Record<string, string>
		}
	>

	// Explicitly type mode for TypeScript
	const currentConfig = configs[mode as keyof typeof configs]

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault()
		try {
			isLoading = true
			errorMessage = ''

			const formData = currentConfig.prepareData()

			const response = await fetch(`${$endpoint}${currentConfig.endpoint}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(formData),
			})

			const data = await response.json()

			if (response.ok && data.token) {
				token.set(data.token)
				online.set(true)
				goto('/')
			} else {
				throw new Error(
					data.error || `${mode === 'login' ? 'Login' : 'Registration'} failed. Please try again.`,
				)
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'An error occurred. Please try again.'
		} finally {
			isLoading = false
		}
	}

	function handleAltModeClick() {
		goto(`/auth/${currentConfig.altMode}`)
	}
</script>

<div class="bg-base-200 flex min-h-screen items-center justify-center">
	<fieldset class="border-base-300 bg-base-100 rounded-box w-full max-w-md border-2 p-6">
		<legend class="text-sm">
			{#if $online}
				<div class="status status-success mr-1 animate-bounce"></div>
			{:else}
				<div class="mr-1 inline-grid *:[grid-area:1/1]">
					<div class="status status-error animate-ping"></div>
					<div class="status status-error"></div>
				</div>
			{/if}
			<span>{$online ? 'Server Online' : 'Server Offline'}</span>
		</legend>

		<div class="mb-6 flex flex-col items-center">
			<h1 class="mb-2 text-3xl font-bold">Stratos</h1>
			<p class="text-base-content/80 text-sm">{currentConfig.title}</p>
		</div>

		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="form-control">
				<span class="fieldset-label text-sm">API Endpoint</span>
				<input
					type="text"
					id="endpoint"
					bind:value={$endpoint}
					placeholder="https://your-api.com/api"
					class="input input-bordered w-full"
					required
				/>
			</div>

			{#if mode === 'register'}
				<div class="form-control">
					<span class="fieldset-label text-sm">Username</span>
					<input
						type="text"
						id="username"
						bind:value={username}
						placeholder="Choose a username"
						class="input input-bordered w-full"
						required
					/>
				</div>
			{/if}

			<div class="form-control">
				<span class="fieldset-label text-sm">E-mail</span>
				<input
					type="email"
					id="email"
					bind:value={email}
					placeholder="Enter your e-mail"
					class="input input-bordered w-full"
					required
				/>
			</div>

			<div class="form-control">
				<span class="fieldset-label text-sm">Password</span>
				<input
					type="password"
					id="password"
					bind:value={password}
					placeholder="Enter your password"
					class="input input-bordered w-full"
					required
				/>
			</div>

			<div class="form-control mt-6">
				<button type="submit" class="btn btn-primary w-full" disabled={isLoading}>
					{#if isLoading}
						<span class="loading loading-spinner loading-sm"></span>
						Connecting...
					{:else}
						{currentConfig.buttonText}
					{/if}
				</button>
			</div>
		</form>

		<div class="divider my-4 text-sm">OR</div>

		<button class="btn w-full" onclick={handleAltModeClick}>
			{currentConfig.altText}
		</button>

		<div class="text-base-content/70 mt-4 text-center text-sm">
			<p>
				Need help? Check out the <a
					href="https://github.com/StratosIO/Stratos"
					class="link link-primary">documentation</a
				>
				.
			</p>
		</div>
	</fieldset>
</div>

{#if errorMessage}
	<div class="toast toast-top toast-start" transition:fly={{ y: -30, duration: 300 }}>
		<div class="alert alert-error alert-soft">
			<span class="material-icons-round">error</span>
			<span class="error-content">{errorMessage}</span>
		</div>
	</div>
{/if}
