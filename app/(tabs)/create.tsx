/**
 * L'onglet « + » ne porte plus d'écran : le parcours de publication vit dans
 * app/create/*, hors de la barre d'onglets, pour occuper tout l'écran.
 *
 * app/(tabs)/_layout.tsx intercepte l'appui sur l'onglet et pousse /create
 * directement. Ce fichier ne sert que de filet : un lien profond vers
 * /(tabs)/create y atterrirait, et rebondit vers le parcours.
 */
import React from 'react';
import { Redirect } from 'expo-router';

export default function CreateTabRedirect() {
  return <Redirect href="/create" />;
}
